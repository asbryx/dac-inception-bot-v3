const { ProxyAgent } = require('undici');
const { paths } = require('../config/paths');
const { readJson } = require('../config/files');

const dispatcherCache = new Map();

function defaultProxySettings() {
  return {
    enabled: false,
    list: [],
    failover: {
      enabled: true,
      healthCheckPath: '/api/inception/network/',
      healthCheckTimeoutMs: 8000,
      cooldownMs: 300000,
      maxAttemptsPerRequest: 3,
      quarantineAfterFailures: 3,
    },
  };
}

function normalizeProxyEntry(entry) {
  if (!entry) return null;

  const raw = typeof entry === 'string' ? entry : entry.url;
  const url = String(raw || '').trim();
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  return {
    url: parsed.toString(),
    label: typeof entry === 'object' && entry.label ? String(entry.label).trim() : parsed.host,
  };
}

function safeProxyUrl(value) {
  if (!value) return value;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
    }
    return parsed.toString();
  } catch {
    return String(value).replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@');
  }
}

function normalizeFailoverSettings(raw = {}) {
  const defaults = defaultProxySettings().failover;
  return {
    enabled: raw?.enabled !== false,
    healthCheckPath: String(raw?.healthCheckPath || defaults.healthCheckPath),
    healthCheckTimeoutMs: Number.isFinite(Number(raw?.healthCheckTimeoutMs)) ? Number(raw.healthCheckTimeoutMs) : defaults.healthCheckTimeoutMs,
    cooldownMs: Number.isFinite(Number(raw?.cooldownMs)) ? Number(raw.cooldownMs) : defaults.cooldownMs,
    maxAttemptsPerRequest: Number.isFinite(Number(raw?.maxAttemptsPerRequest)) ? Math.max(1, Math.trunc(Number(raw.maxAttemptsPerRequest))) : defaults.maxAttemptsPerRequest,
    quarantineAfterFailures: Number.isFinite(Number(raw?.quarantineAfterFailures)) ? Math.max(1, Math.trunc(Number(raw.quarantineAfterFailures))) : defaults.quarantineAfterFailures,
  };
}

function normalizeProxySettings(raw) {
  const defaults = defaultProxySettings();
  if (Array.isArray(raw)) {
    const list = raw.map(normalizeProxyEntry).filter(Boolean);
    return {
      enabled: list.length > 0,
      list,
      failover: normalizeFailoverSettings(defaults.failover),
    };
  }

  if (!raw || typeof raw !== 'object') return defaults;

  const list = Array.isArray(raw.list) ? raw.list.map(normalizeProxyEntry).filter(Boolean) : [];
  return {
    enabled: raw.enabled !== false && list.length > 0,
    list,
    failover: normalizeFailoverSettings(raw.failover),
  };
}

function loadProxySettings(config = null) {
  // 1. Try dedicated proxies.config.json first (auth-safe, never overwritten)
  const dedicated = readJson(paths.proxiesConfigFile, null);
  if (dedicated && (Array.isArray(dedicated) || (dedicated && typeof dedicated === 'object' && Array.isArray(dedicated.list)))) {
    return normalizeProxySettings(dedicated);
  }

  // 2. Fallback to dac.config.json addons
  const loadedConfig = config || require('../config/accounts').loadAccountsConfig();
  return normalizeProxySettings(loadedConfig.addons?.proxies);
}

function isProxyCoolingDown(proxy, state, now, cooldownMs) {
  const entry = state.get(proxy.url);
  if (!entry?.lastFailedAt) return false;
  return now - entry.lastFailedAt < cooldownMs;
}

function isProxyQuarantined(proxy, state, quarantineAfterFailures) {
  const entry = state.get(proxy.url);
  return (entry?.failures || 0) >= quarantineAfterFailures;
}

function createProxyRotation(entries = [], options = {}) {
  const settings = normalizeProxySettings({
    enabled: true,
    list: entries,
    failover: options.failover,
  });
  const list = settings.list;
  const assignmentIndex = new Map();
  const healthState = new Map();
  const assignments = new Map();
  const failoverEvents = [];
  let cursor = 0;

  function markSuccess(proxy) {
    if (!proxy) return;
    const current = healthState.get(proxy.url) || {};
    healthState.set(proxy.url, {
      ...current,
      failures: 0,
      lastOkAt: Date.now(),
      lastFailedAt: null,
      lastError: null,
    });
  }

  function markFailure(proxy, error) {
    if (!proxy) return;
    const current = healthState.get(proxy.url) || { failures: 0 };
    healthState.set(proxy.url, {
      ...current,
      failures: (current.failures || 0) + 1,
      lastFailedAt: Date.now(),
      lastError: error?.message || String(error || 'proxy failure'),
    });
  }

  function selectIndex({ exclude = new Set(), preferHealthy = true } = {}) {
    if (!list.length) return -1;
    const now = Date.now();
    for (let offset = 0; offset < list.length; offset += 1) {
      const index = (cursor + offset) % list.length;
      const proxy = list[index];
      if (exclude.has(proxy.url)) continue;
      if (preferHealthy && isProxyQuarantined(proxy, healthState, settings.failover.quarantineAfterFailures)) continue;
      if (preferHealthy && isProxyCoolingDown(proxy, healthState, now, settings.failover.cooldownMs)) continue;
      cursor = (index + 1) % list.length;
      return index;
    }
    if (!preferHealthy) return -1;
    return selectIndex({ exclude, preferHealthy: false });
  }

  function recordAssignment(accountKey, proxy, source = 'rotation') {
    if (!accountKey || !proxy) return;
    assignments.set(accountKey, {
      key: accountKey,
      proxyUrl: proxy.url,
      label: proxy.label,
      source,
      updatedAt: new Date().toISOString(),
    });
  }

  function assign(accountKey = null) {
    if (!list.length) return null;
    if (accountKey && assignmentIndex.has(accountKey)) {
      const proxy = list[assignmentIndex.get(accountKey)] || null;
      if (proxy) recordAssignment(accountKey, proxy, 'rotation');
      return proxy;
    }
    const index = selectIndex();
    if (index === -1) return null;
    if (accountKey) assignmentIndex.set(accountKey, index);
    const proxy = list[index];
    if (accountKey && proxy) recordAssignment(accountKey, proxy, 'rotation');
    return proxy;
  }

  async function failover(accountKey, currentProxy, { probe = null } = {}) {
    if (!list.length || list.length < 2 || !settings.failover.enabled) return null;

    const exclude = new Set([currentProxy?.url].filter(Boolean));
    while (exclude.size < list.length) {
      const index = selectIndex({ exclude });
      if (index === -1) return null;
      const candidate = list[index];
      if (!candidate) return null;
      if (typeof probe === 'function') {
        const ok = await probe(candidate);
        if (!ok) {
          exclude.add(candidate.url);
          continue;
        }
      }
      if (accountKey) {
        assignmentIndex.set(accountKey, index);
        recordAssignment(accountKey, candidate, 'rotation-failover');
        failoverEvents.push({
          key: accountKey,
          from: currentProxy?.url || null,
          to: candidate.url,
          at: new Date().toISOString(),
        });
      }
      return candidate;
    }
    return null;
  }

  function snapshot() {
    const usedUrls = new Set(Array.from(assignments.values()).map((item) => item.proxyUrl));
    const now = Date.now();
    const rows = list.map((proxy) => {
      const state = healthState.get(proxy.url) || {};
      const assignedTo = Array.from(assignments.values())
        .filter((item) => item.proxyUrl === proxy.url)
        .map((item) => item.key);
      const coolingDown = isProxyCoolingDown(proxy, healthState, now, settings.failover.cooldownMs);
      const quarantined = isProxyQuarantined(proxy, healthState, settings.failover.quarantineAfterFailures);
      let status = 'unused';
      if (assignedTo.length) status = 'assigned';
      if (coolingDown) status = 'cooldown';
      if (quarantined) status = 'quarantined';
      if (assignedTo.length && state.lastOkAt && !coolingDown && !quarantined) status = 'healthy';
      return {
        url: safeProxyUrl(proxy.url),
        label: proxy.label,
        status,
        assignedTo,
        failures: state.failures || 0,
        lastError: state.lastError || null,
        lastOkAt: state.lastOkAt || null,
        lastFailedAt: state.lastFailedAt || null,
      };
    });
    return {
      total: list.length,
      used: usedUrls.size,
      active: rows.filter((row) => row.status === 'healthy' || row.status === 'assigned').length,
      healthy: rows.filter((row) => row.status === 'healthy').length,
      assigned: rows.filter((row) => row.status === 'assigned').length,
      cooldown: rows.filter((row) => row.status === 'cooldown').length,
      quarantined: rows.filter((row) => row.status === 'quarantined').length,
      unused: rows.filter((row) => row.status === 'unused').length,
    assignments: Array.from(assignments.values()).map((item) => ({ ...item, proxyUrl: safeProxyUrl(item.proxyUrl) })),
    failovers: failoverEvents.map((item) => ({ ...item, from: safeProxyUrl(item.from), to: safeProxyUrl(item.to) })),
    rows,
    // Expose read-only snapshots instead of mutable Maps
    _healthState: Object.fromEntries(healthState),
    _assignmentIndex: Object.fromEntries(assignmentIndex),
    };
  }

  return {
    enabled: list.length > 0,
    list,
    settings,
    assign,
    failover,
    markSuccess,
    markFailure,
    healthState,
    snapshot,
    assignments,
    failoverEvents,
  };
}

function createConfiguredProxyRotation(config = null) {
  const settings = loadProxySettings(config);
  return settings.enabled ? createProxyRotation(settings.list, { failover: settings.failover }) : null;
}

function getProxyDispatcher(proxy) {
  const normalized = normalizeProxyEntry(proxy);
  if (!normalized) return null;
  if (!dispatcherCache.has(normalized.url)) {
    dispatcherCache.set(normalized.url, new ProxyAgent(normalized.url));
  }
  return dispatcherCache.get(normalized.url);
}

async function probeProxy(proxy, { targetUrl, timeoutMs = 8000 } = {}) {
  const normalized = normalizeProxyEntry(proxy);
  if (!normalized || !targetUrl) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      dispatcher: getProxyDispatcher(normalized),
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveAccountProxy(accountName, { accountConfig = null, proxy = null, proxyRotation = null } = {}) {
  const explicit = normalizeProxyEntry(proxy || accountConfig?.proxy);
  if (explicit) return { proxy: explicit, source: 'explicit' };
  if (!proxyRotation?.enabled) return { proxy: null, source: 'none' };
  return { proxy: proxyRotation.assign(accountName), source: 'rotation' };
}

module.exports = {
  defaultProxySettings,
  normalizeProxyEntry,
  safeProxyUrl,
  normalizeFailoverSettings,
  normalizeProxySettings,
  loadProxySettings,
  createProxyRotation,
  createConfiguredProxyRotation,
  getProxyDispatcher,
  probeProxy,
  resolveAccountProxy,
};
