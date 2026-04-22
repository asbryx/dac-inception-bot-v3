const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightMagenta: '\x1b[95m',
  brightWhite: '\x1b[97m',
};

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
  accent: 'cyan',
  symbols: {
    ok: '✔',
    fail: '✖',
    stale: '◌',
    ready: '▸',
    bullet: '●',
    arrow: '→',
    dash: '─',
    check: '☑',
    cross: '☒',
    star: '★',
    diamond: '◆',
    circle: '○',
    dot: '·',
  },
};

function color(text, code) {
  if (!process.stdout.isTTY || !code) return String(text);
  return `${code}${text}${ANSI.reset}`;
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

module.exports = { theme, ANSI, color, stripAnsi };
