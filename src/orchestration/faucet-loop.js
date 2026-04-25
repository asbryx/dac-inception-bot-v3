const { accountNames } = require('../config/accounts');
const { validateSelectedAccounts } = require('../config/preflight');
const { runAcrossAccounts } = require('./runner');
const { sleep } = require('../core/bot');

async function runFaucetLoop(bot, { durationHours = 24, intervalMinutes = 60 } = {}) {
  const startedAt = Date.now();
  const effectiveInterval = bot.fastMode ? Math.min(intervalMinutes, 1) : Math.max(intervalMinutes, 1);
  const until = startedAt + durationHours * 60 * 60 * 1000;
  const runs = [];
  let attempt = 0;
  while (Date.now() < until) {
    attempt += 1;
    const timestamp = new Date().toISOString();
    try {
      const result = await bot.runFaucet();
      runs.push({ attempt, timestamp, ok: !!result?.success, result });
    } catch (error) {
      runs.push({ attempt, timestamp, ok: false, error: error.message });
      bot.log(`  Faucet loop error: ${error.message}`);
    }
    if (Date.now() >= until) break;
    bot.log(`  Faucet loop sleeping ${effectiveInterval}m`);
    await sleep(effectiveInterval * 60 * 1000);
  }
  return {
    account: bot.accountName || 'default',
    durationHours,
    intervalMinutes: effectiveInterval,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    runs,
  };
}

async function runFaucetLoopAll({ contextFactory, selected = null, durationHours = 24, intervalMinutes = 60, concurrency = 1, fastMode = false, onStart = null, onComplete = null, onProgress = null } = {}) {
  const accounts = selected && selected.length ? selected : accountNames();
  const preflight = validateSelectedAccounts(accounts);
  const validAccounts = preflight.rows.filter((row) => row.ok).map((row) => row.accountName);
  const invalidResults = preflight.invalid.map((row) => ({
    account: row.accountName,
    ok: false,
    error: `${row.accountName} | preflight | config | ${row.issues.join('; ')}`,
  }));

  const startedAt = Date.now();
  const effectiveInterval = fastMode ? Math.min(intervalMinutes, 1) : Math.max(intervalMinutes, 1);
  const until = startedAt + durationHours * 60 * 60 * 1000;
  const perAccount = [];
  for (const accountName of validAccounts) {
    try {
      const context = await contextFactory(accountName);
      perAccount.push({ account: accountName, bot: context.bot, runs: [] });
    } catch (error) {
      invalidResults.push({ account: accountName, ok: false, error: `context factory failed: ${error.message}` });
    }
  }

  let cycle = 0;
  while (Date.now() < until) {
    cycle += 1;
    const processEntry = async (entry, index) => {
      if (Date.now() >= until) return;
      const timestamp = new Date().toISOString();
      if (typeof onProgress === 'function') onProgress({ account: entry.account, cycle, status: 'running', detail: `cycle ${cycle} attempt ${index + 1}/${perAccount.length}` });
      try {
        const result = await entry.bot.runFaucet();
        entry.runs.push({ cycle, timestamp, ok: !!result?.success, result });
        const ok = !!result?.success;
        if (typeof onProgress === 'function') onProgress({ account: entry.account, cycle, status: ok ? 'claimed' : 'skipped', detail: ok ? `+${result.amount ?? '?'} DACC` : (result?.error || result?.code || 'no reward') });
        return { ok, error: ok ? null : (result?.error || result?.code || 'no reward') };
      } catch (error) {
        entry.runs.push({ cycle, timestamp, ok: false, error: error.message });
        if (typeof onProgress === 'function') onProgress({ account: entry.account, cycle, status: 'failed', detail: error.message });
        return { ok: false, error: error.message };
      }
    };

    if (concurrency > 1) {
      await runAcrossAccounts(
        perAccount.map((entry) => entry.account),
        async (accountName, index) => {
          const outcome = await processEntry(perAccount.find((entry) => entry.account === accountName), index);
          if (!outcome.ok) throw new Error(outcome.error || 'faucet attempt failed');
          return outcome;
        },
        { concurrency, action: 'faucet-loop-cycle', onStart, onComplete },
      );
    } else {
      for (let index = 0; index < perAccount.length; index += 1) {
        if (onStart) onStart({ account: perAccount[index].account, index, total: perAccount.length });
        const outcome = await processEntry(perAccount[index], index);
        if (onComplete) onComplete({ account: perAccount[index].account, index, total: perAccount.length, ok: outcome.ok, error: outcome.error });
      }
    }

    if (Date.now() >= until) break;
    await sleep(effectiveInterval * 60 * 1000);
  }

  return {
    task: 'faucet-loop-all',
    accounts,
    durationHours,
    intervalMinutes: effectiveInterval,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    preflight,
    results: [
      ...invalidResults,
      ...perAccount.map((entry) => ({
        account: entry.account,
        ok: entry.runs.some((row) => row.ok),
        result: {
          account: entry.account,
          durationHours,
          intervalMinutes: effectiveInterval,
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          runs: entry.runs,
        },
      })),
    ],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { runFaucetLoop, runFaucetLoopAll };
