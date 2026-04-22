const { mapLimit } = require('../utils/concurrency');
const { formatBotError, toBotError } = require('../utils/errors');

async function runAcrossAccounts(accounts, worker, { onStart = null, onComplete = null, concurrency = 1, action = 'account-run' } = {}) {
  const wrapped = async (account, index) => {
    if (onStart) onStart({ account, index, total: accounts.length });
    try {
      const result = await worker(account, index);
      const row = { account, ok: true, result };
      if (onComplete) onComplete({ account, index, total: accounts.length, ok: true, result });
      return row;
    } catch (error) {
      const normalized = toBotError(error, { accountName: account, action });
      const row = { account, ok: false, error: formatBotError(normalized) };
      if (onComplete) onComplete({ account, index, total: accounts.length, ok: false, error: row.error });
      return row;
    }
  };
  if (concurrency > 1) return mapLimit(accounts, concurrency, wrapped);
  const results = [];
  for (let index = 0; index < accounts.length; index += 1) results.push(await wrapped(accounts[index], index));
  return results;
}

module.exports = { runAcrossAccounts };
