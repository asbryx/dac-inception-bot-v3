const { theme, ANSI, C, color, stripAnsi } = require('./theme');

// ─── Terminal helpers ───────────────────────────────────

function terminalWidth() {
  const w = Number(process.stdout.columns || 0);
  return Number.isFinite(w) && w > 20 ? w : 100;
}

function clampWidth(width) {
  return Math.max(40, Math.min(width || 88, terminalWidth() - 2));
}

// ─── Text wrapping (ANSI-aware) ─────────────────────────

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
          if (slice[rawIndex] === '\x1b') {
            const m = slice.slice(rawIndex).match(/^\x1b\[[0-9;]*m/);
            if (m) { rawIndex += m[0].length; continue; }
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
  const vis = stripAnsi(text).length;
  return `${text}${' '.repeat(Math.max(0, width - vis))}`;
}

// ─── Box ────────────────────────────────────────────────
// One style for everything. Only the header uses `double`.

function box(title, lines, width = 88, { tone = C.border, style = 'rounded' } = {}) {
  const outer = clampWidth(width);
  const inner = outer - 2;
  const bc = tone;
  const ch = style === 'double' ? {
    b: theme.doubleBorder, l: theme.doubleLeft, r: theme.doubleRight,
    tl: theme.doubleTopLeft, tr: theme.doubleTopRight,
    bl: theme.doubleBottomLeft, br: theme.doubleBottomRight,
    dl: theme.doubleDividerLeft, dr: theme.doubleDividerRight,
  } : {
    b: theme.border, l: theme.left, r: theme.right,
    tl: theme.topLeft, tr: theme.topRight,
    bl: theme.bottomLeft, br: theme.bottomRight,
    dl: theme.dividerLeft, dr: theme.dividerRight,
  };

  const top = `${color(ch.tl, bc)}${color(ch.b.repeat(inner), bc)}${color(ch.tr, bc)}`;
  const ttxt = String(title || '').slice(0, inner - 2);
  const tpad = Math.max(0, inner - 2 - stripAnsi(ttxt).length);
  const tline = `${color(ch.l, bc)} ${color(ttxt, C.title)}${' '.repeat(tpad)} ${color(ch.r, bc)}`;
  const div = `${color(ch.dl, bc)}${color(ch.b.repeat(inner), bc)}${color(ch.dr, bc)}`;

  const body = (lines || [])
    .flatMap((ln) => wrapLine(ln, inner - 2))
    .map((ln) => `${color(ch.l, bc)} ${padAnsi(String(ln), inner - 2)} ${color(ch.r, bc)}`);

  const bot = `${color(ch.bl, bc)}${color(ch.b.repeat(inner), bc)}${color(ch.br, bc)}`;
  return [top, tline, div, ...body, bot].join('\n');
}

function heroBox(title, lines, width = 88) {
  return box(title, lines, width, { tone: ANSI.cyan, style: 'double' });
}

// ─── Progress bar ───────────────────────────────────────

function progressBar(value, max, width = 20) {
  const sMax = Math.max(Number(max) || 0, 1);
  const sVal = Math.max(0, Math.min(Number(value) || 0, sMax));
  const filled = Math.round((sVal / sMax) * width);
  const empty = Math.max(width - filled, 0);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function colorProgressBar(value, max, width = 20) {
  const bar = progressBar(value, max, width);
  const ratio = Math.max(0, Math.min((Number(value) || 0) / Math.max(Number(max) || 1, 1), 1));
  const tone = ratio >= 0.7 ? C.success : ratio >= 0.35 ? C.warn : C.error;
  return `${color(bar, tone)} ${color(`${Math.round(ratio * 100)}%`, C.muted)}`;
}

// ─── Metric line ────────────────────────────────────────
//   Label          Value
// Consistent 2-space indent, label padded to fixed width.

function metric(label, value, { labelWidth = 14, tone = C.value } = {}) {
  return `  ${color(String(label).padEnd(labelWidth), C.label)} ${color(String(value), tone)}`;
}

// ─── Pill (inline tag) ─────────────────────────────────
// Rendered as: ‹text› — no brackets, just colored.

function pill(text, tone = C.accent) {
  return color(text, tone);
}

module.exports = {
  box, heroBox, terminalWidth, wrapLine, clampWidth, padAnsi,
  progressBar, colorProgressBar, metric, pill,
};
