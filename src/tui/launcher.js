const { prompt } = require('../cli/prompts');
const { runLauncher, renderSummaryScreen } = require('./screens');
const { chooseProfile, chooseAutoAllMode } = require('./menus');
const {
  renderSummaryBundle,
  renderProxyPanel,
  renderActionResult,
  renderMultiResultPanel,
  renderLoopPanel,
} = require('./panels');
const { color, C, theme, ANSI } = require('./theme');
const { box, progressBar, colorProgressBar } = require('./renderer');
const { summarizeAccounts } = require('../domain/summary');
const { createAccountContext, createSingleAccountContext } = require('../domain/context');
const { runStatusAll } = require('../orchestration/status-all');
const { runAutomationAll } = require('../orchestration/run-all');
const { runCampaignAll } = require('../orchestration/campaign-all');
const { runTrackAll } = require('../orchestration/track-all');
const { runMintAllRanksAll } = require('../orchestration/mint-all');
const { runFaucetLoop, runFaucetLoopAll } = require('../orchestration/faucet-loop');
const { loadAccountsConfig } = require('../config/accounts');
const { createConfiguredProxyRotation } = require('../addons/proxies');
const { promptMultiToggle, promptNumber, promptConfirm } = require('./toggle');

const S = theme.symbols;

function getProxyRotation() {
  return createConfiguredProxyRotation(loadAccountsConfig());
}

function makeContextFactory(args, proxyRotation) {
  return (accountName) => createAccountContext(accountName, {
    fastMode: !!args.fast,
    humanMode: !args.quiet,
    proxyRotation,
  });
}

// ─── Visual progress helpers ────────────────────────────

function formatAccountStatus(name, p) {
  if (p.ok === true) return `${color('✓', C.success)} ${color(name, C.muted)} ${color('done', C.success)}`;
  if (p.ok === false) return `${color('✗', C.error)} ${color(name, C.muted)} ${color(p.error || 'failed', C.errorText)}`;
  if (p.step) return `${color('▶', C.primary)} ${color(name, C.value)} ${color(p.step, C.primary)} ${p.message ? color(`| ${p.message}`, C.muted) : ''}`;
  return `${color('○', C.muted)} ${color(name, C.muted)} ${color('queued', C.muted)}`;
}

function renderAutoAllBanner(progressMap, totalAccounts, currentAccount) {
  const entries = Array.from(progressMap.entries());
  const doneCount = entries.filter(([, p]) => p.ok === true).length;
  const failCount = entries.filter(([, p]) => p.ok === false).length;
  const bar = colorProgressBar(doneCount + failCount, totalAccounts, 28);

  const lines = [
    `${color(S.diamond, C.primary)} ${color('AUTO ALL', `${ANSI.bold}${C.title}`)}`,
    ``,
    `  ${color('Overall:', C.label)} ${bar}  ${color(`${doneCount + failCount}/${totalAccounts}`, C.value)}`,
    `  ${color('Done:', C.label)}   ${color(String(doneCount), C.success)}  ${color('Fail:', C.label)} ${color(String(failCount), C.error)}`,
    ``,
  ];

  // Show up to 12 accounts in the box; truncate with "..." if more
  const maxVisible = 12;
  let visible = entries.slice(0, maxVisible);
  if (entries.length > maxVisible) {
    visible = entries.slice(0, maxVisible - 1);
    const remaining = entries.length - visible.length;
    visible.push([null, { label: `... and ${remaining} more` }]);
  }

  for (const [name, p] of visible) {
    if (name === null) {
      lines.push(`  ${color(p.label, C.muted)}`);
      continue;
    }
    const isCurrent = name === currentAccount;
    const prefix = isCurrent ? color('›', C.primary) : ' ';
    lines.push(`  ${prefix} ${formatAccountStatus(name, p)}`);
  }

  console.clear();
  process.stdout.write(`${box(`${S.diamond} Automation Progress`, lines, 72)}\n`);
}

function renderFaucetLoopBanner(progressMap, totalAccounts, currentAccount) {
  const entries = Array.from(progressMap.entries());
  const doneCount = entries.filter(([, p]) => p.ok === true).length;
  const failCount = entries.filter(([, p]) => p.ok === false).length;

  const lines = [
    `${color(S.diamond, C.primary)} ${color('FAUCET LOOP ALL', `${ANSI.bold}${C.title}`)}`,
    ``,
    `  ${color('Overall:', C.label)} ${color(`${doneCount + failCount}/${totalAccounts}`, C.value)}`,
    `  ${color('Done:', C.label)}   ${color(String(doneCount), C.success)}  ${color('Fail:', C.label)} ${color(String(failCount), C.error)}`,
    ``,
  ];

  const maxVisible = 12;
  let visible = entries.slice(0, maxVisible);
  if (entries.length > maxVisible) {
    visible = entries.slice(0, maxVisible - 1);
    const remaining = entries.length - visible.length;
    visible.push([null, { label: `... and ${remaining} more` }]);
  }

  for (const [name, p] of visible) {
    if (name === null) {
      lines.push(`  ${color(p.label, C.muted)}`);
      continue;
    }
    const isCurrent = name === currentAccount;
    const prefix = isCurrent ? color('›', C.primary) : ' ';
    if (p.ok === true) {
      lines.push(`  ${prefix} ${color('✓', C.success)} ${color(name, C.muted)} ${color('done', C.success)}`);
    } else if (p.ok === false) {
      lines.push(`  ${prefix} ${color('✗', C.error)} ${color(name, C.muted)} ${color(p.error || 'failed', C.errorText)}`);
    } else if (p.cycle) {
      lines.push(`  ${prefix} ${color('◐', C.primary)} ${color(name, C.value)} cycle ${color(String(p.cycle), C.primary)} ${color(p.status || '', C.muted)}`);
    } else {
      lines.push(`  ${prefix} ${color('○', C.muted)} ${color(name, C.muted)} ${color('queued', C.muted)}`);
    }
  }

  console.clear();
  process.stdout.write(`${box(`${S.diamond} Faucet Loop`, lines, 72)}\n`);
}

function renderAccountRow({ account, index, total, ok, error, step, message }) {
  const idx = `${String(index + 1).padStart(2)}/${String(total).padStart(2)}`;
  if (ok === undefined) {
    return `  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${idx})`, C.muted)} ${color(step || 'starting', C.primary)} ${message ? color(`| ${message}`, C.muted) : ''}`;
  }
  const sym = ok ? color(S.ok, C.success) : color(S.fail, C.error);
  const err = error ? ` ${color(error, C.errorText)}` : '';
  return `  ${sym} ${color(account, C.value)} ${color(`(${idx})`, C.muted)}${err}`;
}

// ─── Auto-all config builder ────────────────────────────

const AUTO_ALL_DEFAULTS = {
  tasks: true,
  badges: true,
  faucet: false,
  crates: false,
  mintScan: true,
  txGrind: false,
  receive: false,
  strategy: false,
  stake: false,
  burn: false,
};

async function buildAutoAllOptions(promptFn) {
  const preset = await chooseAutoAllMode(promptFn);
  if (preset === 'default') {
    return { ...AUTO_ALL_DEFAULTS, profile: 'balanced' };
  }

  const selected = await promptMultiToggle('Toggle automation groups', [
    { label: 'Social/API tasks', value: 'tasks', checked: true },
    { label: 'Badge claiming', value: 'badges', checked: true },
    { label: 'Faucet', value: 'faucet', checked: false },
    { label: 'Crates', value: 'crates', checked: false },
    { label: 'Mint scan', value: 'mintScan', checked: true },
    { label: 'Send TX grind', value: 'txGrind', checked: false },
    { label: 'Receive quest', value: 'receive', checked: false },
    { label: 'Smart strategy mode', value: 'strategy', checked: false },
    { label: 'Stake DACC', value: 'stake', checked: false },
    { label: 'Burn DACC for QE', value: 'burn', checked: false },
  ]);

  const enabled = new Set(selected);

  let profile = 'balanced';
  if (enabled.has('strategy')) {
    profile = (await chooseProfile(promptFn)) || 'balanced';
  }

  let txCount = 3;
  let txAmount = '0.0001';
  if (enabled.has('txGrind')) {
    txCount = await promptNumber(promptFn, 'TX grind count', 3);
    txAmount = (await promptFn('TX grind amount [0.0001]: ')) || '0.0001';
  }

  let stakeAmount = null;
  if (enabled.has('stake')) {
    stakeAmount = (await promptFn('Stake amount [0.01]: ')) || '0.01';
  }

  let burnAmount = null;
  if (enabled.has('burn')) {
    burnAmount = (await promptFn('Burn amount [0.01]: ')) || '0.01';
  }

  return {
    tasks: enabled.has('tasks'),
    badges: enabled.has('badges'),
    faucet: enabled.has('faucet'),
    crates: enabled.has('crates'),
    mintScan: enabled.has('mintScan'),
    txGrind: enabled.has('txGrind'),
    txCount,
    txAmount,
    receive: enabled.has('receive'),
    strategy: enabled.has('strategy'),
    profile,
    stakeAmount,
    burnAmount,
  };
}

function printAutomationReview(target, options) {
  const lines = [
    `${color('Target:', C.label)} ${color(target, C.value)}`,
    '',
    ...Object.entries(options).map(([k, v]) => {
      const val = v === true ? color('ON', C.success) : v === false ? color('OFF', C.muted) : color(String(v), C.value);
      return `  ${color(k.padEnd(14), C.label)} ${val}`;
    }),
  ];
  console.log(`\n${box(`${S.star} Automation Review`, lines, 56)}\n`);
}

// ─── Main launcher loop ─────────────────────────────────

async function runInteractiveLauncher(context, args = {}) {
  const proxyRotation = args.proxyRotation || getProxyRotation();
  const contextFactory = makeContextFactory(args, proxyRotation);

  while (true) {
    const mode = await runLauncher(context, (q) => prompt(q));
    if (!mode || mode === 'exit') break;

    try {
      if (mode === 'account') {
        const config = loadAccountsConfig();
        const names = Object.keys(config.accounts);
        if (!names.length) { console.log(`  ${color('No accounts configured.', C.muted)}`); await prompt('\nPress Enter to continue...'); continue; }
        console.log('\n  Saved accounts:');
        names.forEach((name, idx) => console.log(`  ${idx + 1}. ${name}${name === config.default ? ' (default)' : ''}`));
        const answer = await prompt(`  Choose account [${config.default || names[0]}]: `);
        if (answer) {
          const index = Number(answer);
          const selected = (Number.isInteger(index) && index >= 1 && index <= names.length) ? names[index - 1] : (config.accounts[answer] ? answer : null);
          if (selected) {
            context = await createAccountContext(selected, { fastMode: !!args.fast, humanMode: !args.quiet, proxyRotation });
            console.log(`  ${color(S.ok, C.success)} Switched to ${color(selected, C.primary)}`);
          }
        }
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'summary') {
        const result = await runStatusAll({
          contextFactory,
          concurrency: 4,
          onStart: ({ account, index, total }) => {
            if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
          },
          onComplete: ({ account, index, total, ok, error }) => {
            if (args.quiet) return;
            console.log(ok
              ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
              : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
          },
        });
        console.log(renderSummaryBundle(summarizeAccounts(result.results)));
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'manual') {
        const actions = ['sync', 'explore', 'tasks', 'badges', 'faucet', 'crates', 'mint-scan', 'receive', 'mesh', 'back'];
        console.log('\n  Manual actions:');
        actions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
        const choice = await prompt('  Choose action: ');
        const actionIndex = Number(choice) - 1;
        if (actionIndex >= 0 && actionIndex < actions.length - 1) {
          const action = actions[actionIndex];
          if (action === 'sync') { const result = await context.bot.sync(); console.log(JSON.stringify(result, null, 2)); }
          else if (action === 'explore') await context.bot.runExploration();
          else if (action === 'tasks') await context.bot.runSocialTasks();
          else if (action === 'badges') await context.bot.runBadgeClaim();
          else if (action === 'faucet') await context.bot.runFaucet();
          else if (action === 'crates') await context.bot.runCrates();
          else if (action === 'mint-scan') { const rows = await context.bot.getMintableRanks(); console.log(JSON.stringify(rows, null, 2)); }
          else if (action === 'receive') { const result = await context.bot.receiveTransactions({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
          else if (action === 'mesh') { const result = await context.bot.txMesh({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
        }
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'auto') {
        const options = await buildAutoAllOptions((q) => prompt(q));
        const reviewTarget = context.accountName || 'default account';
        printAutomationReview(reviewTarget, options);
        const go = await promptConfirm((q) => prompt(q), 'Start automation?');
        if (!go) { console.log(color('  Cancelled.', C.muted)); await prompt('\nPress Enter to continue...'); continue; }

        console.log(`\n  ${color(S.tri, C.primary)} Running automation on ${color(reviewTarget, C.value)}...`);
        await context.services.automation.run(options, ({ step, message }) => {
          if (!args.quiet && step && message) console.log(`  ${color(S.tri, C.primary)} ${color(step, C.value)} ${color(S.pipe, C.muted)} ${color(message, C.label)}`);
        });
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'auto-all') {
        const options = await buildAutoAllOptions((q) => prompt(q));
        const config = loadAccountsConfig();
        const names = Object.keys(config.accounts);
        const reviewTarget = `${names.length} accounts`;
        printAutomationReview(reviewTarget, options);
        const go = await promptConfirm((q) => prompt(q), 'Start automation across all accounts?');
        if (!go) { console.log(color('  Cancelled.', C.muted)); await prompt('\nPress Enter to continue...'); continue; }

        const useVisual = process.stdout.isTTY && !args.quiet;
        const progressMap = new Map();
        const totalAccounts = names.length;

        const result = await runAutomationAll({
          contextFactory,
          options,
          selected: args.accounts || undefined,
          onStart: ({ account, index, total }) => {
            progressMap.set(account, { index, total, step: 'starting', message: '' });
            if (useVisual) {
              renderAutoAllBanner(progressMap, totalAccounts, account);
            } else if (!args.quiet) {
              console.log(renderAccountRow({ account, index, total, step: 'starting', message: '' }));
            }
          },
          onComplete: ({ account, index, total, ok, error }) => {
            progressMap.set(account, { index, total, ok, error });
            if (useVisual) {
              renderAutoAllBanner(progressMap, totalAccounts, account);
            } else if (!args.quiet) {
              console.log(renderAccountRow({ account, index, total, ok, error }));
            }
          },
          onProgress: ({ account, step, message }) => {
            const p = progressMap.get(account) || { index: 0, total: 1 };
            progressMap.set(account, { ...p, step, message });
            if (useVisual) {
              renderAutoAllBanner(progressMap, totalAccounts, account);
            } else if (!args.quiet && step && message) {
              console.log(`    ${color(S.dot, C.muted)} ${color(account, C.label)} ${color(S.pipe, C.muted)} ${color(step, C.primary)} ${color(S.pipe, C.muted)} ${color(message, C.label)}`);
            }
          },
        });

        if (useVisual) console.clear();
        console.log(renderSummaryBundle(summarizeAccounts(result.results)));
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'faucet-loop') {
        const durationHours = await promptNumber((q) => prompt(q), 'Duration hours', 24);
        const intervalMinutes = await promptNumber((q) => prompt(q), 'Interval minutes', 60);
        const result = await runFaucetLoop(context.bot, { durationHours, intervalMinutes });
        console.log(renderLoopPanel('Faucet Loop', result));
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'faucet-loop-all') {
        const durationHours = await promptNumber((q) => prompt(q), 'Duration hours', 24);
        const intervalMinutes = await promptNumber((q) => prompt(q), 'Interval minutes', 60);
        const useVisual = process.stdout.isTTY && !args.quiet;
        const progressMap = new Map();
        const totalAccounts = names.length;

        const result = await runFaucetLoopAll({
          contextFactory,
          durationHours,
          intervalMinutes,
          onProgress: useVisual
            ? ({ account, cycle, status, detail }) => {
                const p = progressMap.get(account) || {};
                progressMap.set(account, { ...p, cycle, status, detail });
                renderFaucetLoopBanner(progressMap, totalAccounts, account);
              }
            : ({ account, cycle, status, detail }) => {
                if (!args.quiet) console.log(`  ${color(S.dot, C.muted)} ${color(account, C.label)} cycle ${cycle} ${color(status, C.primary)} ${detail ? color(`| ${detail}`, C.muted) : ''}`);
              },
        });

        if (useVisual) console.clear();
        console.log(renderMultiResultPanel('Faucet Loop All', result));
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'advanced') {
        const tools = ['tx-grind', 'receive', 'burn', 'stake', 'mint-scan', 'mint-all', 'track', 'campaign', 'faucet-loop', 'back'];
        console.log('\n  Advanced tools:');
        tools.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
        const choice = await prompt('  Choose tool: ');
        const toolIndex = Number(choice) - 1;
        if (toolIndex >= 0 && toolIndex < tools.length - 1) {
          const tool = tools[toolIndex];
          if (tool === 'tx-grind') await context.bot.grindTransactions({ count: 3, amount: '0.0001' });
          else if (tool === 'receive') { const result = await context.bot.receiveTransactions({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'burn') { const amount = (await prompt('Burn amount [0.01]: ')) || '0.01'; console.log(JSON.stringify(await context.bot.burnForQE(amount), null, 2)); }
          else if (tool === 'stake') { const amount = (await prompt('Stake amount [0.01]: ')) || '0.01'; console.log(JSON.stringify(await context.bot.stakeDacc(amount), null, 2)); }
          else if (tool === 'mint-scan') { const rows = await context.bot.getMintableRanks(); console.log(JSON.stringify(rows, null, 2)); }
          else if (tool === 'mint-all') { const result = await context.bot.mintAllEligibleRanks(); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'track') { const result = await context.bot.snapshotTracking(); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'campaign') { const profile = (await chooseProfile((q) => prompt(q))) || 'balanced'; console.log(JSON.stringify(await context.bot.runCampaign({ loops: 1, strategyProfile: profile, intervalSeconds: 0 }), null, 2)); }
          else if (tool === 'faucet-loop') { const result = await runFaucetLoop(context.bot, { durationHours: 24, intervalMinutes: 60 }); console.log(JSON.stringify(result, null, 2)); }
        }
        await prompt('\nPress Enter to continue...');
      }
    } catch (error) {
      console.log(`  ${color(S.fail, C.error)} ${color(error.message, C.errorText)}`);
      await prompt('\nPress Enter to continue...');
    }
  }
}

module.exports = { runInteractiveLauncher };
