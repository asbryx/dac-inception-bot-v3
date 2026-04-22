function badgeTotalFromCatalog(catalog) {
  return Array.isArray(catalog?.badges) ? catalog.badges.length : null;
}

function claimableBadges(profile, catalog) {
  const owned = new Set((profile?.badges || []).map((item) => item.badge_key || item.key));
  return (catalog?.badges || []).filter((badge) => badge.claimable && !owned.has(badge.key));
}

module.exports = { badgeTotalFromCatalog, claimableBadges };
