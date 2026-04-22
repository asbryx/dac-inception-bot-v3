const { accountNames } = require('../config/accounts');
const { validateSelectedAccounts } = require('../config/preflight');
const { runAcrossAccounts } = require('./runner');

async function runCampaignAll({ contextFactory, selected = null, profile = 'balanced', onStart = null, onComplete = null } = {}) {
  const accounts = selected && selected.length ? selected : accountNames();
  const preflight = validateSelectedAccounts(accounts);
  const validAccounts = preflight.rows.filter((row) => row.ok).map((row) => row.accountName);
  const invalidResults = preflight.invalid.map((row) => ({
    account: row.accountName,
    ok: false,
    error: `${row.accountName} | preflight | config | ${row.issues.join('; ')}`,
  }));
  const results = await runAcrossAccounts(validAccounts, async (accountName) => {
    const context = await contextFactory(accountName);
    return context.bot.runCampaign({ loops: 1, strategyProfile: profile, intervalSeconds: 0 });
  }, { onStart, onComplete, concurrency: 1, action: 'campaign-all' });
  return {
    task: 'campaign-all',
    accounts,
    preflight,
    results: [...invalidResults, ...results],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { runCampaignAll };
