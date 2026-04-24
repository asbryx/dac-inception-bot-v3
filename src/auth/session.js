function normalizeCookieDomain(domain = '') {
  return String(domain || '').replace(/^\./, '');
}

const COOKIE_ATTRIBUTE_NAMES = new Set([
  'domain',
  'expires',
  'httponly',
  'max-age',
  'path',
  'samesite',
  'secure',
]);

function parseCookieString(cookieString = '') {
  const cookies = {};
  for (const part of String(cookieString || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const name = trimmed.slice(0, index).trim();
    if (COOKIE_ATTRIBUTE_NAMES.has(name.toLowerCase())) continue;
    cookies[name] = trimmed.slice(index + 1).trim();
  }
  return cookies;
}

function buildCookieHeader(cookieString = '') {
  return Object.entries(parseCookieString(cookieString))
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function mergeCookieStrings(...cookieSources) {
  const merged = {};
  for (const source of cookieSources) {
    if (!source) continue;
    Object.assign(merged, parseCookieString(source));
  }
  return Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function extractSetCookieParts(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get ? headers.get('set-cookie') : null;
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,\s]+=)/g);
}

function parseSetCookieHeader(header) {
  if (!header) return null;
  const parts = String(header).split(';').map((part) => part.trim()).filter(Boolean);
  const first = parts.shift();
  if (!first || !first.includes('=')) return null;
  const index = first.indexOf('=');
  const name = first.slice(0, index).trim();
  const value = first.slice(index + 1).trim();
  const attrs = {};
  for (const part of parts) {
    const attrIndex = part.indexOf('=');
    if (attrIndex === -1) attrs[part.toLowerCase()] = true;
    else attrs[part.slice(0, attrIndex).trim().toLowerCase()] = part.slice(attrIndex + 1).trim();
  }
  return { name, value, attrs };
}

module.exports = {
  normalizeCookieDomain,
  parseCookieString,
  buildCookieHeader,
  mergeCookieStrings,
  extractSetCookieParts,
  parseSetCookieHeader,
};
