const { color, ANSI, theme } = require('./theme');

async function chooseLauncherMode(promptFn) {
  const modes = [
    { key: 'auto',          label: 'Auto',          desc: 'guided automation on current account' },
    { key: 'auto-all',      label: 'Auto All',      desc: 'one-click automation for all accounts' },
    { key: 'manual',        label: 'Manual',         desc: 'one task group at a time' },
    { key: 'summary',       label: 'Summary',        desc: 'all-accounts dashboard' },
    { key: 'account',       label: 'Account',        desc: 'switch active account' },
    { key: 'advanced',      label: 'Advanced',       desc: 'mint / burn / stake / tracking' },
    { key: 'exit',          label: 'Exit',           desc: 'quit the launcher' },
  ];

  const hint = modes.map((m) =>
    `  ${color(m.key.padEnd(12), ANSI.brightCyan)} ${color(m.desc, ANSI.dim)}`
  ).join('\n');

  if (process.stdout.isTTY) {
    process.stdout.write(`\n${color(`${theme.symbols.diamond} Select Mode`, `${ANSI.bold}${ANSI.brightWhite}`)}\n`);
    process.stdout.write(`${hint}\n\n`);
  }

  return promptFn(`${color(theme.symbols.ready, ANSI.brightCyan)} Mode: `);
}

async function chooseProfile(promptFn) {
  const profiles = [
    { key: 'safe',       desc: 'conservative reserves, smaller actions' },
    { key: 'balanced',   desc: 'moderate reserves, balanced strategy' },
    { key: 'aggressive', desc: 'low reserves, maximize progression' },
  ];

  const hint = profiles.map((p) =>
    `  ${color(p.key.padEnd(12), ANSI.brightCyan)} ${color(p.desc, ANSI.dim)}`
  ).join('\n');

  if (process.stdout.isTTY) {
    process.stdout.write(`\n${color(`${theme.symbols.diamond} Strategy Profile`, `${ANSI.bold}${ANSI.brightWhite}`)}\n`);
    process.stdout.write(`${hint}\n\n`);
  }

  return promptFn(`${color(theme.symbols.ready, ANSI.brightCyan)} Profile: `);
}

module.exports = { chooseLauncherMode, chooseProfile };
