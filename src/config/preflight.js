const { Wallet } = require('ethers');
const { loadAccountsConfig } = require('./accounts');

function validatePrivateKeyShape(privateKey) {
  const text = String(privateKey || '').trim();
  if (!text) return { ok: false, reason: 'missing private key' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) return { ok: false, reason: 'private key must be 0x + 64 hex chars' };
  try {
    return { ok: true, wallet: new Wallet(text).address };
  } catch (error) {
    return { ok: false, reason: error.message || 'invalid private key' };
  }
}

function validateAccountConfig(accountName, config = {}) {
  const issues = [];
  const warnings = [];
  let wallet = config.wallet || null;

  if (config.privateKey) {
    const keyCheck = validatePrivateKeyShape(config.privateKey);
    if (!keyCheck.ok) issues.push(`private key invalid: ${keyCheck.reason}`);
    else wallet = wallet || keyCheck.wallet;
  } else if (!(config.cookies && config.csrf)) {
    issues.push('missing auth: provide privateKey or cookies + csrf');
  }

  if (config.cookies && !config.csrf) issues.push('cookies present without csrf');
  if (config.csrf && !config.cookies) issues.push('csrf present without cookies');
  if (!wallet) warnings.push('wallet address unavailable');

  return {
    accountName,
    ok: issues.length === 0,
    wallet,
    issues,
    warnings,
  };
}

function validateSelectedAccounts(selected = null) {
  const loaded = loadAccountsConfig();
  const names = selected && selected.length ? selected : Object.keys(loaded.accounts || {});
  const rows = names.map((accountName) => validateAccountConfig(accountName, loaded.accounts[accountName] || {}));
  return {
    ok: rows.every((row) => row.ok),
    rows,
    invalid: rows.filter((row) => !row.ok),
    warnings: rows.filter((row) => row.warnings.length > 0),
  };
}

module.exports = {
  validatePrivateKeyShape,
  validateAccountConfig,
  validateSelectedAccounts,
};
