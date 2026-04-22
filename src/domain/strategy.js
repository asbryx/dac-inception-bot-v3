const profiles = {
  safe: { reserveDacc: 0.5, txCount: 2, txAmount: '0.0001', burnRatio: 0.1, stakeRatio: 0.1 },
  balanced: { reserveDacc: 0.25, txCount: 3, txAmount: '0.0001', burnRatio: 0.2, stakeRatio: 0.2 },
  aggressive: { reserveDacc: 0.15, txCount: 4, txAmount: '0.0001', burnRatio: 0.3, stakeRatio: 0.3 },
};

function buildStrategyPlan(status, profileName = 'balanced') {
  const profile = profiles[profileName] || profiles.balanced;
  const dacc = Number(status?.dacc || 0);
  const reserve = profile.reserveDacc;
  const spendable = Math.max(0, dacc - reserve);
  const actions = [];
  const notes = [
    `balance=${dacc}`,
    `reserve=${reserve}`,
    `spendable=${spendable.toFixed(4)}`,
  ];
  if (spendable > 0.01) {
    actions.push({ type: 'tx-grind', count: profile.txCount, amount: profile.txAmount, reason: 'increase tx progress first' });
    const burnAmount = Number((spendable * profile.burnRatio).toFixed(4));
    const stakeAmount = Number((spendable * profile.stakeRatio).toFixed(4));
    if (burnAmount >= 0.01) actions.push({ type: 'burn', amount: String(burnAmount), reason: 'convert surplus to QE with cap' });
    if (stakeAmount >= 0.01) actions.push({ type: 'stake', amount: String(stakeAmount), reason: 'stake part of surplus with cap' });
  }
  return { profileName, profile, actions, notes };
}

module.exports = { profiles, buildStrategyPlan };
