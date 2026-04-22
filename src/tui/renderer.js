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

function box(title, lines, width = 88, { tone = ANSI.cyan } = {}) {
  const outer = clampWidth(width);
  const inner = outer - 2;
  const borderColor = tone;

  const header = `${color(theme.topLeft, borderColor)}${color(theme.border.repeat(inner), borderColor)}${color(theme.topRight, borderColor)}`;

  const titleText = String(title || '');
  const titleLine = `${color(theme.left, borderColor)} ${color(titleText.slice(0, inner - 1), `${ANSI.bold}${ANSI.brightWhite}`)}${' '.repeat(Math.max(0, inner - 1 - stripAnsi(titleText).length))}${color(theme.right, borderColor)}`;

  const divider = `${color(theme.dividerLeft, borderColor)}${color(theme.border.repeat(inner), borderColor)}${color(theme.dividerRight, borderColor)}`;

  const expandedLines = (lines || []).flatMap((line) => wrapLine(line, inner - 1));
  const body = expandedLines.map((line) =>
    `${color(theme.left, borderColor)} ${padAnsi(String(line), inner - 1)}${color(theme.right, borderColor)}`
  );

  const footer = `${color(theme.bottomLeft, borderColor)}${color(theme.border.repeat(inner), borderColor)}${color(theme.bottomRight, borderColor)}`;

  return [header, titleLine, divider, ...body, footer].join('\n');
}

function progressBar(value, max, width = 20) {
  const safeMax = Math.max(Number(max) || 0, 1);
  const safeValue = Math.max(0, Math.min(Number(value) || 0, safeMax));
  const filled = Math.round((safeValue / safeMax) * width);
  const empty = Math.max(width - filled, 0);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function colorProgressBar(value, max, width = 20) {
  const bar = progressBar(value, max, width);
  const ratio = Math.max(0, Math.min((Number(value) || 0) / Math.max(Number(max) || 1, 1), 1));
  const barTone = ratio >= 0.75 ? ANSI.brightGreen : ratio >= 0.4 ? ANSI.yellow : ANSI.red;
  return color(bar, barTone);
}

function metric(label, value, { labelWidth = 14, tone = ANSI.white } = {}) {
  return `${color(String(label).padEnd(labelWidth), ANSI.dim)} ${color(String(value), tone)}`;
}

function pill(text, tone = ANSI.cyan) {
  return color(`${theme.symbols.bullet} ${text}`, tone);
}

module.exports = { box, terminalWidth, wrapLine, clampWidth, padAnsi, progressBar, colorProgressBar, metric, pill };
