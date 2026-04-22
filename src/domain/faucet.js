function parseFaucet(profile) {
  const cooldown = profile?.faucet_cooldown_seconds;
  if (typeof cooldown === 'number') return { faucetAvailable: cooldown <= 0, faucetCooldownSeconds: Math.max(0, cooldown) };
  if (typeof profile?.faucet_available === 'boolean') return { faucetAvailable: profile.faucet_available, faucetCooldownSeconds: profile.faucet_available ? 0 : null };
  return { faucetAvailable: null, faucetCooldownSeconds: null };
}

module.exports = { parseFaucet };
