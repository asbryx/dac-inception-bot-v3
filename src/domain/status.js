function normalizeTaskSummary(profile) {
  const labels = [];
  if (profile?.telegram_joined) labels.push('telegram');
  if (profile?.discord_linked) labels.push('discord');
  if (profile?.x_followed) labels.push('x-follow');
  if (profile?.x_linked) labels.push('x-link');
  if (profile?.email_verified) labels.push('email');
  if (profile?.faucet_claimed) labels.push('faucet');
  return { done: labels.length, total: 6, labelsDone: labels };
}

function normalizeStatus({ accountName, wallet, profileData = null, networkData = null, catalogData = null, stale = false, errors = [] }) {
  const profile = profileData || {};
  const badgeTotal = Array.isArray(catalogData?.badges) ? catalogData.badges.length : null;
  const normalizedErrors = [
    ...errors,
    profileData?._error || null,
    networkData?._error || null,
    catalogData?._error || null,
  ].filter(Boolean);
  return {
    accountName,
    wallet: wallet || profile.wallet_address || null,
    qe: profile.qe ?? profile.qe_balance ?? null,
    dacc: profile.dacc ?? profile.dacc_balance ?? null,
    rank: profile.rank ?? profile.user_rank ?? null,
    badges: profile.badges_count ?? (Array.isArray(profile.badges) ? profile.badges.length : null),
    badgeTotal,
    streak: profile.streak ?? profile.streak_days ?? null,
    multiplier: profile.multiplier ?? profile.qe_multiplier ?? null,
    txCount: profile.tx_count ?? null,
    faucetAvailable: profile.faucet_available ?? null,
    faucetCooldownSeconds: profile.faucet_cooldown_seconds ?? profile.faucet_seconds_left ?? null,
    referralCount: profile.referral_count ?? null,
    referralCode: profile.referral_code ?? null,
    socials: {
      telegramJoined: typeof profile.telegram_joined === 'boolean' ? profile.telegram_joined : false,
      discordLinked: typeof profile.discord_linked === 'boolean' ? profile.discord_linked : false,
      xFollowed: typeof profile.x_followed === 'boolean' ? profile.x_followed : false,
      xLinked: typeof profile.x_linked === 'boolean' ? profile.x_linked : false,
      emailVerified: typeof profile.email_verified === 'boolean' ? profile.email_verified : false,
    },
    taskSummary: normalizeTaskSummary(profile),
    network: {
      blockNumber: networkData?.block_number ?? null,
      tps: networkData?.tps ?? null,
      blockTime: networkData?.block_time ?? null,
    },
    errors: normalizedErrors,
    stale: stale || !!profileData?._stale || !!networkData?._stale || !!catalogData?._stale,
    updatedAt: new Date().toISOString(),
  };
}

function buildStatusFromProfile(profile, catalog, { badgeTotalFromCatalog } = {}) {
  const badgeTotal = typeof badgeTotalFromCatalog === 'function' ? badgeTotalFromCatalog(catalog) : null;
  // API may return total QE as `qe` directly, or split as `qe_balance` + `waitlist_qe`
  const inceptionQeVal = Number(profile.qe_balance ?? 0);
  const waitlistQeVal = Number(profile.waitlist_qe ?? 0);
  const totalQe = profile.qe != null ? Number(profile.qe) : (inceptionQeVal + waitlistQeVal);
  return {
    qe: totalQe,
    inceptionQe: profile.qe_balance != null ? inceptionQeVal : totalQe,
    waitlistQe: waitlistQeVal,
    dacc: profile.dacc ?? profile.dacc_balance ?? '0',
    txCount: profile.tx_count ?? profile.txCount ?? 0,
    rank: profile.rank ?? profile.user_rank ?? '?',
    badges: profile.badges_count ?? (Array.isArray(profile.badges) ? profile.badges.length : 0),
    badgeTotal,
    badgeCatalogError: catalog?.error || null,
    streak: profile.streak ?? profile.streak_days ?? 0,
    multiplier: profile.multiplier ?? profile.qe_multiplier ?? 1.0,
    faucetAvailable: profile.faucet_available ?? null,
    faucetCooldownSeconds: profile.faucet_cooldown_seconds ?? profile.faucet_seconds_left ?? null,
    discordLinked: profile.discord_linked ?? false,
    xLinked: profile.x_linked ?? false,
    telegramJoined: profile.telegram_joined ?? false,
    wallet: profile.wallet_address ?? profile.wallet ?? '',
    profile,
  };
}

async function fetchDashboardSnapshot(bot, { force = false } = {}) {
  const cachedStatus = !force ? bot.getCachedValue('status') : null;
  const cachedNetwork = !force ? bot.getCachedValue('network') : null;
  const cachedCatalog = !force ? bot.getCachedValue('badgeCatalog') : null;
  if (cachedStatus && cachedNetwork && cachedCatalog) {
    return { status: cachedStatus, network: cachedNetwork, catalog: cachedCatalog };
  }

  const profile = (!force && cachedStatus?.profile)
    ? cachedStatus.profile
    : await bot.withCache('profile', 15000, () => bot.api('GET', '/profile/'), { force });

  if (profile.error && profile.qe == null && profile.qe_balance == null) {
    return {
      status: { error: profile.error, statusCode: profile._status || 0 },
      network: cachedNetwork || await bot.network({ force }),
      catalog: cachedCatalog || null,
    };
  }

  const [catalog, network] = await Promise.all([
    cachedCatalog || bot.badgeCatalog({ force }),
    cachedNetwork || bot.network({ force }),
  ]);

  const status = (!force && cachedStatus && cachedCatalog)
    ? cachedStatus
    : buildStatusFromProfile(profile, catalog, { badgeTotalFromCatalog: bot.badgeTotalFromCatalog });

  bot.runtimeCache.status = { value: status, expiresAt: Date.now() + 15000, pending: null };
  return { status, network, catalog };
}

async function status(bot, { force = false } = {}) {
  const snapshot = await fetchDashboardSnapshot(bot, { force });
  return snapshot.status;
}

module.exports = {
  normalizeTaskSummary,
  normalizeStatus,
  buildStatusFromProfile,
  fetchDashboardSnapshot,
  status,
};
