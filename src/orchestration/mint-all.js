const { accountNames } = require('../config/accounts');
const { validateSelectedAccounts } = require('../config/preflight');
const { runAcrossAccounts } = require('./runner');

async function runMintAllRanksAll({ contextFactory, selected = null, onStart = null, onComplete = null, concurrency = 1 } = {}) {
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
    return context.bot.mintAllEligibleRanks();
  }, { onStart, onComplete, concurrency, action: 'mint-all-ranks-all' });
  return {
    task: 'mint-all-ranks-all',
    accounts,
    preflight,
    results: [...invalidResults, ...results],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { runMintAllRanksAll };
