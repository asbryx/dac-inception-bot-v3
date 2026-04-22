function planCrates(status, { maxOpens = 5 } = {}) {
  const qe = Number(status?.qe || 0);
  if (!Number.isFinite(qe) || qe <= 0) return 0;
  return Math.min(maxOpens, Math.floor(qe / 1000));
}

module.exports = { planCrates };
