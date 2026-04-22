const { accountNames } = require('../config/accounts');
const { validateSelectedAccounts } = require('../config/preflight');
const { runAcrossAccounts } = require('./runner');

async function runReceiveAll({ contextFactory, selected = null, count = 1, amount = '0.0001', onStart = null, onComplete = null } = {}) {
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
    return context.bot.receiveTransactions({ count, amount });
  }, { onStart, onComplete, concurrency: 1, action: 'receive-all' });
  return {
    task: 'receive-all',
    accounts,
    preflight,
    results: [...invalidResults, ...results],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { runReceiveAll };
