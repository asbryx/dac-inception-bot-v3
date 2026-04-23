const { accountNames } = require('../config/accounts');
const { validateSelectedAccounts } = require('../config/preflight');
const { runAcrossAccounts } = require('./runner');

async function runAutomationAll({ contextFactory, selected = null, options = {}, onStart = null, onComplete = null, onProgress = null, concurrency = 1 } = {}) {
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
    return context.services.automation.run(options, (event) => onProgress && onProgress({ account: accountName, ...event }));
  }, { onStart, onComplete, concurrency, action: 'run-all' });
  return {
    task: 'run-all',
    accounts,
    preflight,
    results: [...invalidResults, ...results],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { runAutomationAll };
