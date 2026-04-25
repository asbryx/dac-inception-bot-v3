const { mapLimit } = require('../utils/concurrency');
const { formatBotError, toBotError } = require('../utils/errors');
const { classifyFailure } = require('./reporting');

async function withTimeout(promise, timeoutMs, account) {
  if (!timeoutMs) return promise;
  let timer;
  let timedOut = false;
  const timeoutError = new Error(`${account} timed out after ${timeoutMs}ms`);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    if (!timedOut) throw error;
    // Let the account worker settle before freeing this concurrency slot.
    await promise.catch(() => null);
    throw timeoutError;
  } finally {
    clearTimeout(timer);
  }
}

async function runAcrossAccounts(accounts, worker, { onStart = null, onComplete = null, concurrency = 1, action = 'account-run', timeoutMs = 0 } = {}) {
  const wrapped = async (account, index) => {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    if (onStart) onStart({ account, index, total: accounts.length, startedAt });
    try {
      const result = await withTimeout(worker(account, index), timeoutMs, account);
      const durationMs = Date.now() - startedAtMs;
      const row = { account, ok: true, result, startedAt, durationMs };
      if (onComplete) onComplete({ account, index, total: accounts.length, ok: true, result, startedAt, durationMs });
      return row;
    } catch (error) {
      const normalized = toBotError(error, { accountName: account, action });
      const durationMs = Date.now() - startedAtMs;
      const row = {
        account,
        ok: false,
        error: formatBotError(normalized),
        failureType: classifyFailure(normalized),
        startedAt,
        durationMs,
      };
      if (onComplete) onComplete({ account, index, total: accounts.length, ok: false, error: row.error, failureType: row.failureType, startedAt, durationMs });
      return row;
    }
  };
  if (concurrency > 1) {
    return mapLimit(accounts, concurrency, wrapped);
  }
  const results = [];
  for (let index = 0; index < accounts.length; index += 1) results.push(await wrapped(accounts[index], index));
  return results;
}

module.exports = { runAcrossAccounts };
