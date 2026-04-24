const { retryRead } = require('./retry');

function isReadOnlyApiPath(apiPath) {
  return [
    '/profile/',
    '/network/',
    '/badges/catalog/',
    '/crate/history/',
    '/qe-history/',
    '/exchange/history/',
    '/faucet-history/',
  ].some((prefix) => apiPath.startsWith(prefix));
}

function getApiTimeoutMs(apiPath) {
  if (isReadOnlyApiPath(apiPath)) return 25000;
  if (apiPath.startsWith('/task/') || apiPath.startsWith('/visit/')) return 12000;
  return 20000;
}

function getFallbackPayload(bot, apiPath) {
  if (apiPath === '/network/') return bot.getCachedValue('network') || null;
  if (apiPath === '/profile/') {
    const cachedStatus = bot.getCachedValue('status');
    return cachedStatus?.profile || bot.getCachedValue('profile') || null;
  }
  if (apiPath === '/badges/catalog/') return bot.getCachedValue('badgeCatalog') || null;
  return null;
}

function buildTimeoutMessage(method, apiPath, timeoutMs) {
  return `Timeout: ${method} ${apiPath} after ${timeoutMs}ms`;
}

async function fetchOnce(bot, apiPath, { method = 'GET', body } = {}) {
  const timeoutMs = getApiTimeoutMs(apiPath);
  if (typeof bot.reportActivity === 'function') bot.reportActivity(`${method} ${apiPath}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await bot.apiClient.fetchWithSession(`${bot.apiBase}${apiPath}`, {
      method,
      body,
      signal: controller.signal,
    });
    const payload = await bot.apiClient.fetchJsonResponse(response);
    payload._status = response.status;
    if (typeof bot.reportActivity === 'function') bot.reportActivity(`${method} ${apiPath} -> ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error(buildTimeoutMessage(method, apiPath, timeoutMs)), {
        code: 'REQUEST_TIMEOUT',
        apiPath,
        method,
        timeoutMs,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableReadStatus(status) {
  return status === 429 || status >= 500;
}

async function fetchReadOnceWithRetryableStatus(bot, apiPath, { method, body }) {
  const payload = await fetchOnce(bot, apiPath, { method, body });
  if (isRetryableReadStatus(payload._status || 0)) {
    const error = new Error(payload.error || `Retryable API status ${payload._status}`);
    error.status = payload._status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function fetchApiPayload(bot, apiPath, { method = 'GET', body } = {}) {
  const isRead = method === 'GET' && isReadOnlyApiPath(apiPath);
  try {
    if (isRead) {
      return await retryRead(() => fetchReadOnceWithRetryableStatus(bot, apiPath, { method, body }), { retries: 1, backoffMs: 500, fastMode: bot.fastMode });
    }
    return await fetchOnce(bot, apiPath, { method, body });
  } catch (error) {
    if (error.payload) return error.payload;
    if (error.code === 'REQUEST_TIMEOUT') {
      const fallback = getFallbackPayload(bot, apiPath);
      if (fallback) {
        return {
          ...fallback,
          _status: -1,
          _cached: true,
          _stale: true,
          _timeout: true,
          _error: error.message,
          error: error.message,
        };
      }
      return { error: error.message, _status: 0, _timeout: true };
    }
    return { error: error.message, _status: 0 };
  }
}

async function api(bot, method, apiPath, body, { retryAuth = true } = {}) {
  await bot.ensureSession(false);
  if (!isReadOnlyApiPath(apiPath) && !bot.fastMode) await bot.humanPause('api');

  try {
    const payload = await fetchApiPayload(bot, apiPath, { method, body });
    const classification = bot.classifyResponse(payload._status || 0, payload);

    if (
      retryAuth
      && bot.apiClient.isAuthFailure(payload)
      && bot.walletAddress
      && !classification.challenge
      && !classification.rateLimited
    ) {
      bot.log('⚠️  Session invalid or expired, refreshing via wallet auth...');
      if (!bot.fastMode) await bot.humanPause('session');
      await bot.walletLogin(true);
      return api(bot, method, apiPath, body, { retryAuth: false });
    }

    if (classification.challenge) {
      bot.log(`  Challenge/block detected (${payload._status || 0})`);
      return payload;
    }
    if (classification.rateLimited) {
      bot.log(`  Rate limited (429)`);
      return payload;
    }
    if (classification.blocked) {
      bot.log(`  Blocked (${payload._status || 0})`);
      return payload;
    }

    return payload;
  } catch (error) {
    return { error: error.message, _status: 0 };
  }
}

function profile(bot, { force = false } = {}) {
  return bot.withCache('profile', 15000, () => api(bot, 'GET', '/profile/'), { force });
}

function network(bot, { force = false } = {}) {
  return bot.withCache('network', 10000, () => api(bot, 'GET', '/network/'), { force });
}

function badgeCatalog(bot, { force = false } = {}) {
  return bot.withCache('badgeCatalog', 30000, () => api(bot, 'GET', '/badges/catalog/'), { force });
}

function createEndpoints(bot) {
  return {
    api: (method, apiPath, body, options) => api(bot, method, apiPath, body, options),
    profile: (options) => profile(bot, options),
    network: (options) => network(bot, options),
    badgeCatalog: (options) => badgeCatalog(bot, options),
    config: () => api(bot, 'GET', '/config/'),
    sync: () => api(bot, 'POST', '/sync/', {}),
    crateHistory: () => api(bot, 'GET', '/crate/history/'),
    qeHistory: () => api(bot, 'GET', '/qe-history/'),
    exchangeHistory: () => api(bot, 'GET', '/exchange/history/'),
    completeTask: (task, extra = {}) => api(bot, 'POST', '/task/', { task, ...extra }),
    claimBadge: (badgeKey) => api(bot, 'POST', '/claim-badge/', { badge_key: badgeKey }),
    claimFaucet: () => api(bot, 'POST', '/faucet/', {}),
    faucetHistory: () => api(bot, 'GET', '/faucet-history/'),
    faucetStatus: (dispenseId) => api(bot, 'GET', `/faucet/status/${dispenseId}/`),
    openCrate: () => api(bot, 'POST', '/crate/open/', {}),
    visitPage: (pathValue) => api(bot, 'POST', '/visit/', { path: pathValue }),
    visitExplorer: () => api(bot, 'POST', '/visit/explorer/', {}),
    claimSignature: (rankKey) => api(bot, 'POST', '/nft/claim-signature/', { rank_key: rankKey }),
    confirmMint: (txHash, rankKey) => api(bot, 'POST', '/nft/confirm-mint/', { tx_hash: txHash, rank_key: rankKey }),
    confirmBurn: (txHash) => api(bot, 'POST', '/exchange/confirm-burn/', { tx_hash: txHash }),
    confirmStake: (txHash) => api(bot, 'POST', '/exchange/confirm-stake/', { tx_hash: txHash }),
  };
}

module.exports = {
  isReadOnlyApiPath,
  getApiTimeoutMs,
  getFallbackPayload,
  isRetryableReadStatus,
  fetchApiPayload,
  api,
  profile,
  network,
  badgeCatalog,
  createEndpoints,
};
