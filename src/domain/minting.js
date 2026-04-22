const ranks = [
  { id: 0, qe: 0, badgeKey: 'rank_cadet', name: 'Cadet' },
  { id: 1, qe: 1000, badgeKey: 'rank_commando', name: 'Commando' },
  { id: 2, qe: 2000, badgeKey: 'rank_seal', name: 'Seal' },
  { id: 3, qe: 5000, badgeKey: 'rank_shadow', name: 'Shadow Unit' },
  { id: 4, qe: 10000, badgeKey: 'rank_vanguard', name: 'Vanguard' },
  { id: 5, qe: 25000, badgeKey: 'rank_sentinel', name: 'Sentinel' },
  { id: 6, qe: 50000, badgeKey: 'rank_sovereign', name: 'Sovereign' },
  { id: 7, qe: 100000, badgeKey: 'rank_warrior', name: 'Warrior' },
  { id: 8, qe: 200000, badgeKey: 'rank_architect', name: 'Architect' },
  { id: 9, qe: 300000, badgeKey: 'rank_interceptor', name: 'Interceptor' },
  { id: 10, qe: 400000, badgeKey: 'rank_phantom', name: 'Phantom' },
  { id: 11, qe: 500000, badgeKey: 'rank_cipher', name: 'Cipher' },
  { id: 12, qe: 750000, badgeKey: 'rank_crown', name: 'Crown' },
];

function scanRanks({ qe = 0, ownedBadges = [], mintedByRank = {}, backendReady = {} }) {
  const owned = new Set(ownedBadges);
  return ranks.map((rank) => ({
    rankId: rank.id,
    rankKey: rank.badgeKey,
    rankName: rank.name,
    qeThreshold: rank.qe,
    eligibleByQe: qe >= rank.qe,
    badgeOwned: owned.has(rank.badgeKey),
    backendReady: !!backendReady[rank.badgeKey],
    minted: !!mintedByRank[rank.id],
  }));
}

module.exports = { ranks, scanRanks };
