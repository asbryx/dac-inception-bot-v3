const path = require('path');
const { paths } = require('./paths');

function secretFiles() {
  return new Set([
    path.resolve(paths.appConfigFile),
    path.resolve(paths.childWalletsFile),
  ]);
}

function isSecretFile(file) {
  return secretFiles().has(path.resolve(file));
}

function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/0x[a-fA-F0-9]{64}/g, '0x***redacted***')
      .replace(/(csrftoken=)[^;\s]+/gi, '$1***redacted***')
      .replace(/(sessionid=)[^;\s]+/gi, '$1***redacted***')
      .replace(/(csrf"?\s*:\s*"?)[^",\s]+/gi, '$1***redacted***')
      .replace(/(cookies"?\s*:\s*"?)[^"]+/gi, '$1***redacted***')
      .replace(/(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, '$1***redacted***:***redacted***@');
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/(privateKey|cookies|csrf|mnemonic|password|proxy|proxyUrl|url|token|secret)/i.test(key)) return [key, '***redacted***'];
      return [key, redactSecrets(item)];
    }));
  }
  return value;
}

module.exports = { isSecretFile, redactSecrets };
