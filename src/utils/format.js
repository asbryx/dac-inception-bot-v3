const { formatDuration } = require('./time');

function asDisplay(value, fallback = '?') {
  return value == null || value === '' ? fallback : String(value);
}

function shortAddress(value) {
  if (!value) return '?';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortHash(value) {
  if (!value) return '?';
  const text = String(value);
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-8)}`;
}

function shortUrl(value) {
  if (!value) return '?';
  const text = String(value);
  try {
    const url = new URL(text);
    const tail = url.pathname.length > 24 ? `${url.pathname.slice(0, 12)}...${url.pathname.slice(-10)}` : url.pathname;
    return `${url.hostname}${tail}`;
  } catch {
    return text.length > 40 ? `${text.slice(0, 20)}...${text.slice(-16)}` : text;
  }
}

function shortenError(value, max = 96) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function faucetDisplay(status) {
  if (status == null) return '?';
  if (status === true) return 'ready';
  if (status === false) return 'cooldown';
  return String(status);
}

function table(headers, rows) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => String(row[index] ?? '').length)));
  const headerRow = headers.map((header, index) => String(header).padEnd(widths[index])).join('  ');
  const body = rows.map((row) => row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  '));
  return [headerRow, ...body].join('\n');
}

function formatSummaryCell(value, kind = 'text') {
  if (value == null) return '?';
  if (kind === 'faucet') return value === true ? 'ready' : formatDuration(value) || 'cooldown';
  return String(value);
}

module.exports = { asDisplay, shortAddress, shortHash, shortUrl, shortenError, faucetDisplay, table, formatSummaryCell };
