const { theme, ANSI, color, stripAnsi } = require('./theme');

function terminalWidth() {
  const width = Number(process.stdout.columns || 0);
  return Number.isFinite(width) && width > 20 ? width : 100;
}

function clampWidth(width) {
  return Math.max(40, Math.min(width || 88, terminalWidth() - 2));
}

function wrapLine(text, inner) {
  const raw = String(text ?? '');
  if (!raw) return [''];
  const parts = raw.split('\n');
  const wrapped = [];
  for (const part of parts) {
    if (stripAnsi(part).length <= inner) {
      wrapped.push(part);
      continue;
    }
    let remaining = part;
    while (stripAnsi(remaining).length > inner) {
      let take = Math.min(remaining.length, inner + 16);
      let slice = remaining.slice(0, take);
      while (stripAnsi(slice).length > inner && take > 0) {
        take -= 1;
        slice = remaining.slice(0, take);
      }
      const visible = stripAnsi(slice);
      const breakAt = visible.lastIndexOf(' ');
      if (breakAt > Math.floor(inner * 0.4)) {
        let visibleCount = 0;
        let rawIndex = 0;
        while (rawIndex < slice.length && visibleCount < breakAt) {
          const char = slice[rawIndex];
          if (char === '\x1b') {
            const match = slice.slice(rawIndex).match(/^\x1b\[[0-9;]*m/);
            if (match) {
              rawIndex += match[0].length;
              continue;
            }
          }
          visibleCount += 1;
          rawIndex += 1;
        }
        wrapped.push(slice.slice(0, rawIndex));
        remaining = remaining.slice(rawIndex).replace(/^\s+/, '');
      } else {
        wrapped.push(slice);
        remaining = remaining.slice(slice.length);
      }
    }
    wrapped.push(remaining);
  }
  return wrapped;
}

function padAnsi(text, width) {
  const visible = stripAnsi(text).length;
  return `${text}${' '.repeat(Math.max(0, width - visible))}`;
}

// ── Box styles ──────────────────────────────────────────

function box(title, lines, width = 88, { tone = ANSI.cyan, style = 'rounded' } = {}) {
  const outer = clampWidth(width);
  const inner = outer - 2;
  const borderColor = tone;

  const chars = getBoxChars(style);

  const header = `${color(chars.topLeft, borderColor)}${color(chars.border.repeat(inner), borderColor)}${color(chars.topRight, borderColor)}`;

  const titleText = String(title || '');
  const trimmedTitle = titleText.slice(0, inner - 2);
  const titleLen = stripAnsi(trimmedTitle).length;
  const titlePad = Math.max(0, inner - 2 - titleLen);
  const titleLine = `${color(chars.left, borderColor)} ${color(trimmedTitle, `${ANSI.bold}${ANSI.brightWhite}`)}${' '.repeat(titlePad)} ${color(chars.right, borderColor)}`;

  const divider = `${color(chars.dividerLeft, borderColor)}${color(chars.border.repeat(inner), borderColor)}${color(chars.dividerRight, borderColor)}`;

  const expandedLines = (lines || []).flatMap((line) => wrapLine(line, inner - 2));
  const body = expandedLines.map((line) =>
    `${color(chars.left, borderColor)} ${padAnsi(String(line), inner - 2)} ${color(chars.right, borderColor)}`
  );

  const footer = `${color(chars.bottomLeft, borderColor)}${color(chars.border.repeat(inner), borderColor)}${color(chars.bottomRight, borderColor)}`;

  return [header, titleLine, divider, ...body, footer].join('\n');
}

function heroBox(title, lines, width = 88, { tone = ANSI.brightCyan } = {}) {
  return box(title, lines, width, { tone, style: 'double' });
}

function heavyBox(title, lines, width = 88, { tone = ANSI.cyan } = {}) {
  return box(title, lines, width, { tone, style: 'heavy' });
}

function getBoxChars(style) {
  if (style === 'double') {
    return {
      border: theme.doubleBorder,
      left: theme.doubleLeft,
      right: theme.doubleRight,
      topLeft: theme.doubleTopLeft,
      topRight: theme.doubleTopRight,
      bottomLeft: theme.doubleBottomLeft,
      bottomRight: theme.doubleBottomRight,
      dividerLeft: theme.doubleDividerLeft,
      dividerRight: theme.doubleDividerRight,
    };
  }
  if (style === 'heavy') {
    return {
      border: theme.heavyBorder,
      left: theme.heavyLeft,
      right: theme.heavyRight,
      topLeft: theme.heavyTopLeft,
      topRight: theme.heavyTopRight,
      bottomLeft: theme.heavyBottomLeft,
      bottomRight: theme.heavyBottomRight,
      dividerLeft: theme.heavyDividerLeft,
      dividerRight: theme.heavyDividerRight,
    };
  }
  return {
    border: theme.border,
    left: theme.left,
    right: theme.right,
    topLeft: theme.topLeft,
    topRight: theme.topRight,
    bottomLeft: theme.bottomLeft,
    bottomRight: theme.bottomRight,
    dividerLeft: theme.dividerLeft,
    dividerRight: theme.dividerRight,
  };
}

// ── Progress bars ───────────────────────────────────────

function progressBar(value, max, width = 20) {
  const safeMax = Math.max(Number(max) || 0, 1);
  const safeValue = Math.max(0, Math.min(Number(value) || 0, safeMax));
  const filled = Math.round((safeValue / safeMax) * width);
  const partial = Math.round(((safeValue / safeMax) * width - filled) * 4);
  const empty = Math.max(width - filled - (partial > 0 ? 1 : 0), 0);
  const partialChars = ['', '░', '▒', '▓'];
  return `${'█'.repeat(filled)}${partialChars[partial] || ''}${'░'.repeat(empty)}`;
}

function colorProgressBar(value, max, width = 20) {
  const bar = progressBar(value, max, width);
  const ratio = Math.max(0, Math.min((Number(value) || 0) / Math.max(Number(max) || 1, 1), 1));
  const barTone = ratio >= 0.75 ? ANSI.brightGreen : ratio >= 0.4 ? ANSI.brightYellow : ratio >= 0.15 ? ANSI.orange : ANSI.red;
  const pct = `${Math.round(ratio * 100)}%`;
  return `${color(bar, barTone)} ${color(pct, ANSI.dim)}`;
}

// ── Metric / label helpers ──────────────────────────────

function metric(label, value, { labelWidth = 14, tone = ANSI.white } = {}) {
  return `  ${color(String(label).padEnd(labelWidth), ANSI.slate)} ${color(String(value), tone)}`;
}

function pill(text, tone = ANSI.cyan) {
  return color(`[ ${text} ]`, tone);
}

function badge(text, tone = ANSI.brightCyan) {
  return `${color(theme.symbols.sparkle, tone)} ${color(text, `${ANSI.bold}${tone}`)}`;
}

function tag(label, value, tone = ANSI.brightCyan) {
  return `${color(label, ANSI.slate)}${color(':', ANSI.darkGray)} ${color(value, tone)}`;
}

function separator(width = 88, char = '─', tone = ANSI.darkGray) {
  const outer = clampWidth(width);
  return color(char.repeat(outer), tone);
}

function sectionTitle(text, tone = ANSI.brightWhite) {
  return `\n  ${color(theme.symbols.triangleRight, tone)} ${color(text, `${ANSI.bold}${tone}`)}`;
}

function blankLine() {
  return '';
}

module.exports = {
  box,
  heroBox,
  heavyBox,
  terminalWidth,
  wrapLine,
  clampWidth,
  padAnsi,
  progressBar,
  colorProgressBar,
  metric,
  pill,
  badge,
  tag,
  separator,
  sectionTitle,
  blankLine,
};
