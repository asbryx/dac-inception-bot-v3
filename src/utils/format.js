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
  // Calculate column widths from visible text only (strip ANSI)
  const stripAnsi = (text) => String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
  const widths = headers.map((header, index) =>
    Math.max(
      stripAnsi(header).length,
      ...rows.map((row) => stripAnsi(row[index] ?? '').length),
    ),
  );

  // Pad cells accounting for ANSI escape sequences
  const padCell = (text, width) => {
    const visible = stripAnsi(text).length;
    return `${text}${' '.repeat(Math.max(0, width - visible))}`;
  };

  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const slate = '\x1b[38;5;245m';
  const brightWhite = '\x1b[97m';
  const darkGray = '\x1b[38;5;238m';

  const headerRow = headers.map((header, index) =>
    `${brightWhite}${padCell(header, widths[index])}${reset}`
  ).join(`  ${darkGray}│${reset}  `);

  const dividerRow = widths.map((w) => `${darkGray}${'─'.repeat(w)}${reset}`).join(`──${darkGray}┼${reset}──`);

  const body = rows.map((row) =>
    row.map((cell, index) => padCell(String(cell ?? ''), widths[index])).join(`  ${darkGray}│${reset}  `)
  );

  return [headerRow, dividerRow, ...body].join('\n');
}

function formatSummaryCell(value, kind = 'text') {
  if (value == null) return '?';
  if (kind === 'faucet') return value === true ? 'ready' : formatDuration(value) || 'cooldown';
  return String(value);
}

module.exports = { asDisplay, shortAddress, shortHash, shortUrl, shortenError, faucetDisplay, table, formatSummaryCell };
