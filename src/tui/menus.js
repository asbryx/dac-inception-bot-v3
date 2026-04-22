const { color, ANSI, theme } = require('./theme');
const { box } = require('./renderer');

async function chooseLauncherMode(promptFn) {
  const modes = [
    { key: 'auto',     icon: theme.symbols.bolt,     label: 'Auto',     desc: 'Guided automation on current account' },
    { key: 'auto-all', icon: theme.symbols.rocket,   label: 'Auto All', desc: 'One-click automation for all accounts' },
    { key: 'manual',   icon: theme.symbols.ready,    label: 'Manual',   desc: 'One task group at a time' },
    { key: 'summary',  icon: theme.symbols.diamond,  label: 'Summary',  desc: 'All-accounts dashboard' },
    { key: 'account',  icon: theme.symbols.circle,   label: 'Account',  desc: 'Switch active account' },
    { key: 'advanced', icon: theme.symbols.star,      label: 'Advanced', desc: 'Mint / burn / stake / tracking' },
    { key: 'exit',     icon: theme.symbols.arrow,     label: 'Exit',     desc: 'Quit the launcher' },
  ];

  const lines = modes.map((m) => {
    const keyDisplay = color(m.key.padEnd(12), ANSI.brightCyan);
    const iconDisplay = color(m.icon, m.key === 'exit' ? ANSI.slate : ANSI.teal);
    const descDisplay = color(m.desc, ANSI.warmGray);
    return `  ${iconDisplay} ${keyDisplay} ${descDisplay}`;
  });

  if (process.stdout.isTTY) {
    const menuBox = box(`${theme.symbols.diamond} Select Mode`, [
      '',
      ...lines,
      '',
    ], 56, { tone: ANSI.brightCyan });
    process.stdout.write(`\n${menuBox}\n\n`);
  }

  return promptFn(`  ${color(theme.symbols.triangleRight, ANSI.brightCyan)} ${color('Mode:', ANSI.brightWhite)} `);
}

async function chooseProfile(promptFn) {
  const profiles = [
    { key: 'safe',       icon: theme.symbols.shield,   desc: 'Conservative reserves, smaller actions' },
    { key: 'balanced',   icon: theme.symbols.diamond,   desc: 'Moderate reserves, balanced strategy' },
    { key: 'aggressive', icon: theme.symbols.fire,      desc: 'Low reserves, maximize progression' },
  ];

  const lines = profiles.map((p) => {
    const keyDisplay = color(p.key.padEnd(12), ANSI.brightCyan);
    const iconDisplay = color(p.icon, ANSI.teal);
    const descDisplay = color(p.desc, ANSI.warmGray);
    return `  ${iconDisplay} ${keyDisplay} ${descDisplay}`;
  });

  if (process.stdout.isTTY) {
    const menuBox = box(`${theme.symbols.star} Strategy Profile`, [
      '',
      ...lines,
      '',
    ], 56, { tone: ANSI.gold });
    process.stdout.write(`\n${menuBox}\n\n`);
  }

  return promptFn(`  ${color(theme.symbols.triangleRight, ANSI.brightCyan)} ${color('Profile:', ANSI.brightWhite)} `);
}

module.exports = { chooseLauncherMode, chooseProfile };
