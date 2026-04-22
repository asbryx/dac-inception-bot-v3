// ─── ANSI escape codes ──────────────────────────────────
// Strict palette: primary (cyan), success (green), warn (yellow),
// error (red), muted (gray), accent (white). Nothing else in panels.

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // base 16
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  black: '\x1b[30m',

  // bright 16
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightMagenta: '\x1b[95m',
  brightWhite: '\x1b[97m',
  brightBlue: '\x1b[94m',
  brightRed: '\x1b[91m',

  // backgrounds (used sparingly)
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',

  // 256-color — only grays + one accent
  gray: '\x1b[38;5;245m',       // labels, muted text
  darkGray: '\x1b[38;5;238m',   // borders, dividers, dim info
  lightGray: '\x1b[38;5;250m',  // secondary values
};

// ─── Semantic color roles ───────────────────────────────
// Every panel references these instead of raw ANSI codes so
// changing the palette later is a single-line edit.

const C = {
  border:    ANSI.darkGray,      // all box borders
  title:     `${ANSI.bold}${ANSI.brightWhite}`,
  label:     ANSI.gray,          // metric labels
  value:     ANSI.brightWhite,   // metric values (default)
  primary:   ANSI.brightCyan,    // key data: account, QE
  success:   ANSI.brightGreen,   // ok, complete, healthy
  warn:      ANSI.brightYellow,  // stale, cooldown
  error:     ANSI.red,           // fail, error
  errorText: ANSI.brightRed,     // error message body
  muted:     ANSI.darkGray,      // placeholder dashes, dim info
  dim:       ANSI.dim,           // timestamps, secondary
  accent:    ANSI.cyan,          // pills, highlights
};

// ─── Box drawing ────────────────────────────────────────

const theme = {
  border: '─',
  left: '│',
  right: '│',
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  dividerLeft: '├',
  dividerRight: '┤',

  // Only for the main header box
  doubleBorder: '═',
  doubleLeft: '║',
  doubleRight: '║',
  doubleTopLeft: '╔',
  doubleTopRight: '╗',
  doubleBottomLeft: '╚',
  doubleBottomRight: '╝',
  doubleDividerLeft: '╠',
  doubleDividerRight: '╣',

  // ─── Symbols (monospace-safe Unicode only, NO emoji) ──
  symbols: {
    ok: '✓',
    fail: '✗',
    stale: '○',
    bullet: '•',
    arrow: '→',
    dash: '─',
    star: '★',
    diamond: '◆',
    circle: '○',
    dot: '·',
    tri: '▸',
    pipe: '│',
  },
};

// ─── ASCII banner ───────────────────────────────────────

const BANNER = [
  '  ╔═══════════════════════════════════════════════════╗',
  '  ║   ___    _    ___   ___      _     __   ____     ║',
  '  ║  |   \\  / \\  / __| | _ ) ___| |_  \\ \\ / /\\ \\    ║',
  '  ║  | |) |/ _ \\| (__  | _ \\/ _ \\  _|  \\ V /  \\ \\   ║',
  '  ║  |___//_/ \\_\\\\___| |___/\\___/\\__|   \\_/    \\_\\  ║',
  '  ║                                                   ║',
  '  ║           I N C E P T I O N   B O T  v3           ║',
  '  ╚═══════════════════════════════════════════════════╝',
];

// ─── Helpers ────────────────────────────────────────────

function color(text, code) {
  if (!process.stdout.isTTY || !code) return String(text);
  return `${code}${text}${ANSI.reset}`;
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function colorBanner() {
  return BANNER.map((line) => color(line, ANSI.cyan)).join('\n');
}

module.exports = { theme, ANSI, C, color, stripAnsi, colorBanner };
