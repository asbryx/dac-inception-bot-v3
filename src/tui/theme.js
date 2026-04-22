const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  strikethrough: '\x1b[9m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  black: '\x1b[30m',
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgMagenta: '\x1b[45m',
  bgWhite: '\x1b[47m',
  bgBlack: '\x1b[40m',
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightMagenta: '\x1b[95m',
  brightWhite: '\x1b[97m',
  brightBlue: '\x1b[94m',
  brightRed: '\x1b[91m',
  // 256-color accents
  orange: '\x1b[38;5;208m',
  teal: '\x1b[38;5;37m',
  pink: '\x1b[38;5;205m',
  lavender: '\x1b[38;5;183m',
  lime: '\x1b[38;5;154m',
  skyBlue: '\x1b[38;5;117m',
  gold: '\x1b[38;5;220m',
  slate: '\x1b[38;5;245m',
  deepPurple: '\x1b[38;5;99m',
  coral: '\x1b[38;5;209m',
  mint: '\x1b[38;5;121m',
  steel: '\x1b[38;5;67m',
  warmGray: '\x1b[38;5;249m',
  darkGray: '\x1b[38;5;238m',
  midGray: '\x1b[38;5;243m',
  // 256-color backgrounds
  bgDarkGray: '\x1b[48;5;236m',
  bgDeepBlue: '\x1b[48;5;17m',
  bgSlate: '\x1b[48;5;237m',
};

const theme = {
  // Box drawing - double-line for primary, single for secondary
  border: '─',
  left: '│',
  right: '│',
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  dividerLeft: '├',
  dividerRight: '┤',
  // Heavy variants for emphasis
  heavyBorder: '━',
  heavyLeft: '┃',
  heavyRight: '┃',
  heavyTopLeft: '┏',
  heavyTopRight: '┓',
  heavyBottomLeft: '┗',
  heavyBottomRight: '┛',
  heavyDividerLeft: '┣',
  heavyDividerRight: '┫',
  // Double-line for hero boxes
  doubleBorder: '═',
  doubleLeft: '║',
  doubleRight: '║',
  doubleTopLeft: '╔',
  doubleTopRight: '╗',
  doubleBottomLeft: '╚',
  doubleBottomRight: '╝',
  doubleDividerLeft: '╠',
  doubleDividerRight: '╣',

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
    // New symbols
    rocket: '🚀',
    bolt: '⚡',
    shield: '🛡',
    chain: '⛓',
    fire: '🔥',
    trophy: '🏆',
    sparkle: '✦',
    arrowRight: '▸',
    arrowDown: '▾',
    triangleRight: '►',
    triangleUp: '▲',
    triangleDown: '▼',
    pipe: '│',
    thinDot: '∙',
    ellipsis: '…',
    doubleDash: '──',
    section: '§',
    radioOn: '◉',
    radioOff: '◯',
    boxFull: '█',
    boxLight: '░',
    boxMed: '▒',
    boxHeavy: '▓',
  },
};

const BANNER_LINES = [
  '     ██████╗   █████╗   ██████╗',
  '     ██╔══██╗ ██╔══██╗ ██╔════╝',
  '     ██║  ██║ ███████║ ██║     ',
  '     ██║  ██║ ██╔══██║ ██║     ',
  '     ██████╔╝ ██║  ██║ ╚██████╗',
  '     ╚═════╝  ╚═╝  ╚═╝  ╚═════╝',
];

const BANNER_TAGLINE = 'I N C E P T I O N   B O T   v 3';

function color(text, code) {
  if (!process.stdout.isTTY || !code) return String(text);
  return `${code}${text}${ANSI.reset}`;
}

function gradient(text, codes) {
  if (!process.stdout.isTTY || !codes.length) return String(text);
  const chars = String(text).split('');
  return chars.map((char, i) => {
    const code = codes[i % codes.length];
    return `${code}${char}${ANSI.reset}`;
  }).join('');
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function colorBanner() {
  const bannerColors = [ANSI.brightCyan, ANSI.teal, ANSI.skyBlue, ANSI.brightCyan, ANSI.teal, ANSI.skyBlue];
  const lines = BANNER_LINES.map((line, i) => color(line, bannerColors[i % bannerColors.length]));
  const tagline = `     ${gradient(BANNER_TAGLINE, [ANSI.skyBlue, ANSI.brightCyan, ANSI.teal, ANSI.mint])}`;
  return [...lines, '', tagline].join('\n');
}

module.exports = { theme, ANSI, color, gradient, stripAnsi, colorBanner, BANNER_LINES, BANNER_TAGLINE };
