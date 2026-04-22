const { paths } = require('./paths');
const { readJson, writeJson } = require('./files');
const { requireAccountName } = require('../utils/validation');

const { defaultProxySettings, normalizeProxySettings } = require('../addons/proxies');

function defaultConfig() {
  return { default: null, accounts: {}, addons: { proxies: defaultProxySettings() } };
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultConfig();
  const accounts = raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {};
  return {
    default: raw.default || Object.keys(accounts)[0] || null,
    accounts,
    addons: {
      proxies: normalizeProxySettings(raw.addons?.proxies),
    },
  };
}

function loadAccountsConfig() {
  return normalizeConfig(readJson(paths.appConfigFile, defaultConfig()));
}

function saveAccountsConfig(config) {
  const normalized = normalizeConfig(config);
  writeJson(paths.appConfigFile, normalized);
  return normalized;
}

function accountNames() {
  return Object.keys(loadAccountsConfig().accounts);
}

function getAccount(name = null) {
  const config = loadAccountsConfig();
  const resolvedName = name || config.default;
  return resolvedName ? { accountName: resolvedName, config: config.accounts[resolvedName] || null } : null;
}

function upsertAccount(name, payload, { makeDefault = false, preservePrivateKey = true } = {}) {
  const accountName = requireAccountName(name);
  const current = loadAccountsConfig();
  const existing = current.accounts[accountName] || {};
  const next = {
    ...existing,
    ...payload,
  };
  if (preservePrivateKey && !payload.privateKey && existing.privateKey) next.privateKey = existing.privateKey;
  current.accounts[accountName] = next;
  if (makeDefault || !current.default) current.default = accountName;
  return saveAccountsConfig(current);
}

module.exports = {
  defaultConfig,
  normalizeConfig,
  loadAccountsConfig,
  saveAccountsConfig,
  accountNames,
  getAccount,
  upsertAccount,
};
