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
    const tail = url.pathname.length > 24
      ? `${url.pathname.slice(0, 12)}...${url.pathname.slice(-10)}`
      : url.pathname;
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

// ─── Table ──────────────────────────────────────────────
// Clean table with dim column separators and an underline
// beneath the header. ANSI-aware width calculation.

function table(headers, rows) {
  const strip = (t) => String(t || '').replace(/\x1b\[[0-9;]*m/g, '');
  const widths = headers.map((h, i) =>
    Math.max(strip(h).length, ...rows.map((r) => strip(r[i] ?? '').length)),
  );
  const pad = (t, w) => {
    const vis = strip(t).length;
    return `${t}${' '.repeat(Math.max(0, w - vis))}`;
  };

  const W = '\x1b[97m';       // brightWhite
  const D = '\x1b[38;5;238m'; // darkGray
  const R = '\x1b[0m';        // reset

  const sep = `  ${D}│${R}  `;
  const hdr = headers.map((h, i) => `${W}${pad(h, widths[i])}${R}`).join(sep);
  const rule = widths.map((w) => `${D}${'─'.repeat(w)}${R}`).join(`──${D}┼${R}──`);
  const body = rows.map((r) =>
    r.map((c, i) => pad(String(c ?? ''), widths[i])).join(sep),
  );
  return [hdr, rule, ...body].join('\n');
}

function formatSummaryCell(value, kind = 'text') {
  if (value == null) return '?';
  if (kind === 'faucet') return value === true ? 'ready' : formatDuration(value) || 'cooldown';
  return String(value);
}

module.exports = { asDisplay, shortAddress, shortHash, shortUrl, shortenError, faucetDisplay, table, formatSummaryCell };
