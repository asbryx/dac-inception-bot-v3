function sanitizePositiveNumber(value, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = integer ? Math.trunc(parsed) : parsed;
  if (normalized < minimum || normalized > maximum) return fallback;
  return normalized;
}

function requireAmount(value, field) {
  const text = String(value || '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid ${field}: ${value}`);
  if (Number(text) <= 0) throw new Error(`Invalid ${field}: ${value}`);
  return text;
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`Invalid ${field}: ${value}`);
  return value;
}

function requireRankKey(value) {
  const text = String(value || '').trim();
  if (!/^rank_[a-z0-9_]+$/.test(text)) throw new Error(`Invalid rank key: ${value}`);
  return text;
}

function requireAccountName(value) {
  const text = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) throw new Error(`Invalid account name: ${value}`);
  return text;
}

module.exports = {
  sanitizePositiveNumber,
  requireAmount,
  requireOneOf,
  requireRankKey,
  requireAccountName,
};
