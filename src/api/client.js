const {
  normalizeCookieDomain,
  extractSetCookieParts,
  parseSetCookieHeader,
  mergeCookieStrings,
  parseCookieString,
  buildCookieHeader,
} = require('../auth/session');
const { getProxyDispatcher, probeProxy } = require('../addons/proxies');

async function fetchJsonResponse(response) {
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json')
    ? response.json()
    : { error: `Non-JSON response (${response.status})`, body: (await response.text()).slice(0, 300) };
}

function isAuthFailure(payload) {
  const status = payload?._status || 0;
  const text = `${payload?.error || ''} ${payload?.body || ''}`.toLowerCase();
  return status === 401
    || status === 403
    || text.includes('csrf verification failed')
    || text.includes('authentication credentials were not provided');
}

function cookieDomainMatchesHost(domain, host) {
  return domain === host || host.endsWith(`.${domain}`);
}

function applySetCookieHeaders(bot, response, csrf) {
  const setCookieHeaders = extractSetCookieParts(response.headers);
  if (!setCookieHeaders.length) return;

  const newCookies = [];
  for (const header of setCookieHeaders) {
    const parsed = parseSetCookieHeader(header);
    if (!parsed) continue;
    const responseHost = response.url ? new URL(response.url).hostname : new URL(bot.baseUrl).hostname;
    const domain = normalizeCookieDomain(parsed.attrs.domain || responseHost);
    if (!cookieDomainMatchesHost(domain, responseHost)) continue;
    newCookies.push(`${parsed.name}=${parsed.value}`);
  }

  if (!newCookies.length) return;
  const mergedCookieString = mergeCookieStrings(bot.session?.cookies, newCookies.join('; '));
  const csrfCookie = parseCookieString(mergedCookieString).csrftoken || csrf;
  bot.setSession(mergedCookieString, csrfCookie, true);
}

function shouldFailoverResponse(response, method = 'GET') {
  if (!response) return false;
  if (response.status === 407) return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return [502, 503, 504].includes(response.status);
}

async function failoverProxy(bot, failedProxy, error) {
  if (!bot.proxyRotation?.enabled || !bot.proxyRotation.settings?.failover?.enabled) return false;
  if (bot.proxySource === 'explicit') return false;

  bot.proxyRotation.markFailure(failedProxy, error);
  const probeUrl = `${bot.baseUrl}${bot.proxyRotation.settings.failover.healthCheckPath}`;
  const nextProxy = await bot.proxyRotation.failover(bot.proxyKey, failedProxy, {
    probe: async (candidate) => {
      const ok = await probeProxy(candidate, {
        targetUrl: probeUrl,
        timeoutMs: bot.proxyRotation.settings.failover.healthCheckTimeoutMs,
      });
      if (!ok) bot.proxyRotation.markFailure(candidate, new Error('proxy health check failed'));
      else bot.proxyRotation.markSuccess(candidate);
      return ok;
    },
  });

  if (!nextProxy) return false;
  bot.proxy = nextProxy;
  bot.proxySource = 'rotation-failover';
  return true;
}

async function fetchWithSession(bot, url, { method = 'GET', headers = {}, body, sessionOverride, signal } = {}) {
  const requestUrl = new URL(url, bot.baseUrl);
  if (requestUrl.origin !== new URL(bot.baseUrl).origin) {
    throw new Error(`Refusing to send session credentials to ${requestUrl.origin}`);
  }
  if (typeof bot.rotateUserAgent === 'function' && bot.humanMode && bot.humanFeatures?.rotateUserAgent !== false) {
    bot.rotateUserAgent();
  }
  const cookieHeader = sessionOverride?.cookieHeader || (sessionOverride?.cookies ? buildCookieHeader(sessionOverride.cookies) : '') || bot.session?.cookieHeader || '';
  const csrf = sessionOverride?.csrf || bot.session?.csrf || '';
  const requestHeaders = {
    ...bot.buildDefaultHeaders(bot.session.userAgent),
    ...headers,
  };
  if (cookieHeader) requestHeaders.cookie = cookieHeader;
  if (csrf) requestHeaders['x-csrftoken'] = csrf;
  if (body === undefined) delete requestHeaders['content-type'];

  const maxAttempts = bot.proxyRotation?.settings?.failover?.enabled
    ? Math.max(1, bot.proxyRotation.settings.failover.maxAttemptsPerRequest)
    : 1;

  let attempt = 0;
  let lastError = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    const activeProxy = bot.proxy;
    try {
      const dispatcher = getProxyDispatcher(activeProxy);
      const response = await fetch(requestUrl, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: 'manual',
        dispatcher: dispatcher || undefined,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error(`Refusing redirect while sending session credentials (${response.status})`);
      }
      const proxyHttpFailure = shouldFailoverResponse(response, method) && activeProxy;
      if (proxyHttpFailure) {
        lastError = new Error(`Proxy HTTP ${response.status}`);
        const moved = await failoverProxy(bot, activeProxy, lastError);
        if (moved) continue;
        if (activeProxy && bot.proxyRotation?.enabled) bot.proxyRotation.markFailure(activeProxy, lastError);
      }
      if (activeProxy && bot.proxyRotation?.enabled && !proxyHttpFailure) bot.proxyRotation.markSuccess(activeProxy);
      applySetCookieHeaders(bot, response, csrf);
      return response;
    } catch (error) {
      lastError = error;
      const moved = await failoverProxy(bot, activeProxy, error);
      if (!moved) throw error;
    }
  }

  throw lastError || new Error('Proxy request failed');
}

function createApiClient(bot) {
  return {
    fetchJsonResponse,
    isAuthFailure,
    fetchWithSession: (url, options) => fetchWithSession(bot, url, options),
  };
}

module.exports = {
  fetchJsonResponse,
  isAuthFailure,
  fetchWithSession,
  createApiClient,
};
