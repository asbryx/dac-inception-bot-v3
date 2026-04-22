const { color, ANSI, C, theme } = require('./theme');
const { box } = require('./renderer');

const S = theme.symbols;

async function chooseLauncherMode(promptFn) {
  const modes = [
    { key: 'auto',     label: 'Guided automation on current account' },
    { key: 'auto-all', label: 'One-click automation for all accounts' },
    { key: 'manual',   label: 'One task group at a time' },
    { key: 'summary',  label: 'All-accounts dashboard' },
    { key: 'account',  label: 'Switch active account' },
    { key: 'advanced', label: 'Mint / burn / stake / tracking' },
    { key: 'exit',     label: 'Quit the launcher' },
  ];

  const lines = ['', ...modes.map((m) =>
    `  ${color(S.tri, C.primary)} ${color(m.key.padEnd(12), C.value)}  ${color(m.label, C.label)}`
  ), ''];

  if (process.stdout.isTTY) {
    process.stdout.write(`\n${box(`${S.diamond} Select Mode`, lines, 56)}\n\n`);
  }

  return promptFn(`  ${color(S.tri, C.primary)} ${color('Mode:', C.value)} `);
}

async function chooseProfile(promptFn) {
  const profiles = [
    { key: 'safe',       label: 'Conservative reserves, smaller actions' },
    { key: 'balanced',   label: 'Moderate reserves, balanced strategy' },
    { key: 'aggressive', label: 'Low reserves, maximize progression' },
  ];

  const lines = ['', ...profiles.map((p) =>
    `  ${color(S.tri, C.primary)} ${color(p.key.padEnd(12), C.value)}  ${color(p.label, C.label)}`
  ), ''];

  if (process.stdout.isTTY) {
    process.stdout.write(`\n${box(`${S.star} Strategy Profile`, lines, 56)}\n\n`);
  }

  return promptFn(`  ${color(S.tri, C.primary)} ${color('Profile:', C.value)} `);
}

module.exports = { chooseLauncherMode, chooseProfile };
