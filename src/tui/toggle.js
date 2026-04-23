const { color, C, theme, ANSI } = require('./theme');
const { box, terminalWidth } = require('./renderer');
const readline = require('readline');

const S = theme.symbols;

const { prompt } = require('../cli/prompts');

// ─── promptMultiToggle ──────────────────────────────────
// Interactive checkbox menu for TTY. Falls back to numeric
// prompt for non-TTY (e.g. piping, CI).
//
// items: [{ label, value, checked? }]
// returns: string[] of selected values

function promptMultiToggle(title, items) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptMultiToggleFallback(title, items);
  }
  return promptMultiToggleTTY(title, items);
}

async function promptMultiToggleFallback(title, items) {
  const state = items.map((item) => ({ ...item }));
  console.log(`\n${color(String(title).toUpperCase(), `${ANSI.bold}${C.title}`)}`);
  console.log(color('Enter numbers separated by commas to toggle. Leave blank to keep defaults.', C.muted));
  state.forEach((item, idx) => {
    const mark = item.checked ? color('[x]', C.success) : color('[ ]', C.muted);
    console.log(`  ${String(idx + 1).padStart(2)}. ${mark} ${item.label}`);
  });
  const answer = await prompt('Toggle items: ');
  if (!answer) return state.filter((item) => item.checked).map((item) => item.value);
  const toggledIndexes = Array.from(new Set(
    answer.split(',').map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length),
  ));
  toggledIndexes.forEach((toggleIndex) => {
    state[toggleIndex - 1].checked = !state[toggleIndex - 1].checked;
  });
  return state.filter((item) => item.checked).map((item) => item.value);
}

function promptMultiToggleTTY(title, items) {
  const state = items.map((item) => ({ ...item }));
  let index = 0;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const width = Math.min(60, terminalWidth() - 4);

  function render() {
    const lines = state.map((item, idx) => {
      const active = idx === index;
      const pointer = active ? color('›', C.primary) : color('·', C.muted);
      const mark = item.checked ? color('[x]', C.success) : color('[ ]', C.muted);
      const label = active ? color(item.label, C.value) : color(item.label, C.label);
      return ` ${pointer} ${mark} ${label}`;
    });
    const header = [
      color(String(title).toUpperCase(), `${ANSI.bold}${C.title}`),
      color('↑↓ Move  Space toggle  Enter confirm  q cancel', C.muted),
    ];
    const content = box(`${S.diamond} Select Options`, [...header, '', ...lines], width, { tone: C.border, style: 'rounded' });
    console.clear();
    process.stdout.write(`${content}\n`);
  }

  return new Promise((resolve) => {
    render();

    function cleanup() {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
      process.stdin.removeListener('keypress', onKeypress);
    }

    function onKeypress(_, key) {
      if (!key) return;
      if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve([]);
        return;
      }
      if (key.name === 'up') {
        index = (index - 1 + state.length) % state.length;
        render();
        return;
      }
      if (key.name === 'down') {
        index = (index + 1) % state.length;
        render();
        return;
      }
      if (key.name === 'space') {
        state[index].checked = !state[index].checked;
        render();
        return;
      }
      if (key.name === 'return') {
        cleanup();
        resolve(state.filter((item) => item.checked).map((item) => item.value));
        return;
      }
    }

    process.stdin.on('keypress', onKeypress);
  });
}

// ─── promptNumber ───────────────────────────────────────

async function promptNumber(promptFn, label, defaultValue) {
  const answer = await promptFn(`${label} [${defaultValue}]: `);
  const num = Number(answer);
  return Number.isFinite(num) && num > 0 ? num : defaultValue;
}

// ─── promptConfirm ──────────────────────────────────────

async function promptConfirm(promptFn, message) {
  const answer = await promptFn(`${message} [Y/n]: `);
  return answer.toLowerCase() !== 'n';
}

// ─── promptSingleSelect ─────────────────────────────────
// Interactive single-select menu for TTY. Falls back to
// numeric prompt for non-TTY.
//
// items: [{ label, value }]
// returns: selected value string, or null on cancel

function promptSingleSelect(title, items) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptSingleSelectFallback(title, items);
  }
  return promptSingleSelectTTY(title, items);
}

async function promptSingleSelectFallback(title, items) {
  console.log(`\n${color(String(title).toUpperCase(), `${ANSI.bold}${C.title}`)}`);
  items.forEach((item, idx) => {
    console.log(`  ${String(idx + 1).padStart(2)}. ${item.label}`);
  });
  const answer = await prompt('Select: ');
  if (!answer) return null;
  const num = Number(answer);
  if (Number.isInteger(num) && num >= 1 && num <= items.length) return items[num - 1].value;
  const direct = items.find((item) => item.value === answer);
  return direct ? direct.value : null;
}

function promptSingleSelectTTY(title, items) {
  let index = 0;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const width = Math.min(60, terminalWidth() - 4);

  function render() {
    const lines = items.map((item, idx) => {
      const active = idx === index;
      const pointer = active ? color('›', C.primary) : color('·', C.muted);
      const label = active ? color(item.label, C.value) : color(item.label, C.label);
      return ` ${pointer} ${label}`;
    });
    const header = [
      color(String(title).toUpperCase(), `${ANSI.bold}${C.title}`),
      color('↑↓ Move  Enter select  q cancel', C.muted),
    ];
    const content = box(`${S.diamond} Select`, [...header, '', ...lines], width, { tone: C.border, style: 'rounded' });
    console.clear();
    process.stdout.write(`${content}\n`);
  }

  return new Promise((resolve) => {
    render();

    function cleanup() {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
      process.stdin.removeListener('keypress', onKeypress);
    }

    function onKeypress(_, key) {
      if (!key) return;
      if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve(null);
        return;
      }
      if (key.name === 'up') {
        index = (index - 1 + items.length) % items.length;
        render();
        return;
      }
      if (key.name === 'down') {
        index = (index + 1) % items.length;
        render();
        return;
      }
      if (key.name === 'return') {
        cleanup();
        resolve(items[index].value);
        return;
      }
    }

    process.stdin.on('keypress', onKeypress);
  });
}

module.exports = {
  promptMultiToggle,
  promptNumber,
  promptConfirm,
  promptSingleSelect,
};
