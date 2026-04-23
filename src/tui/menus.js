const { color, ANSI, C, theme } = require('./theme');
const { box } = require('./renderer');
const { promptSingleSelect } = require('./toggle');

const S = theme.symbols;

async function chooseLauncherMode(promptFn) {
  return promptSingleSelect('Select Mode', [
    { label: 'Auto               — Guided automation on current account', value: 'auto' },
    { label: 'Auto All           — One-click automation for all accounts', value: 'auto-all' },
    { label: 'Manual             — One task group at a time', value: 'manual' },
    { label: 'Summary            — All-accounts dashboard', value: 'summary' },
    { label: 'Faucet Loop        — Single account 24h mode', value: 'faucet-loop' },
    { label: 'Faucet Loop All    — Multi-account 24h mode', value: 'faucet-loop-all' },
    { label: 'Account            — Switch active account', value: 'account' },
    { label: 'Advanced           — Mint / burn / stake / tracking', value: 'advanced' },
    { label: 'Exit               — Quit the launcher', value: 'exit' },
  ]);
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

async function chooseAutoAllMode(promptFn) {
  const modes = [
    { key: 'default',    label: 'Default (tasks + badges + mintScan)' },
    { key: 'custom',     label: 'Custom — toggle every option' },
  ];

  const lines = ['', ...modes.map((m) =>
    `  ${color(S.tri, C.primary)} ${color(m.key.padEnd(12), C.value)}  ${color(m.label, C.label)}`
  ), ''];

  if (process.stdout.isTTY) {
    process.stdout.write(`\n${box(`${S.diamond} Auto All Preset`, lines, 56)}\n\n`);
  }

  return promptFn(`  ${color(S.tri, C.primary)} ${color('Preset:', C.value)} `);
}

module.exports = { chooseLauncherMode, chooseProfile, chooseAutoAllMode };
