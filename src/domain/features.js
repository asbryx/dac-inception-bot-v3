const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dac-bot-v3');
const FEATURES_FILE = path.join(CONFIG_DIR, 'features.json');

// ─── Feature Registry ───────────────────────────────────
// Every discrete operation the bot can perform. Each has a
// persistent toggle, category grouping, and dependency chain.

const FEATURE_REGISTRY = [
  // ── Social / API Tasks ──
  { id: 'task_signin',   label: 'Daily Sign-in',      category: 'tasks',  default: true,  description: 'Record daily login streak' },
  { id: 'task_sync',     label: 'Account Sync',       category: 'tasks',  default: true,  description: 'Sync profile state with backend' },
  { id: 'task_telegram', label: 'Telegram Quest',     category: 'tasks',  default: true,  description: 'Complete Telegram social quest' },
  { id: 'task_x_follow', label: 'X Follow Quest',     category: 'tasks',  default: true,  description: 'Complete X/Twitter follow quest' },

  // ── Badges ──
  { id: 'badge_claim',   label: 'Claim Badges',       category: 'badges', default: true,  description: 'Claim all eligible backend badges' },

  // ── Rewards ──
  { id: 'faucet_claim',  label: 'Claim Faucet',       category: 'rewards', default: false, description: 'Request testnet DACC from faucet' },
  { id: 'crate_open',    label: 'Open Crates',        category: 'rewards', default: false, description: 'Open available reward crates' },

  // ── Minting ──
  { id: 'mint_scan',     label: 'Scan Mintable',      category: 'minting', default: true,  description: 'Check which ranks are mintable on-chain' },
  { id: 'mint_claim',    label: 'Mint Ranks',         category: 'minting', default: true,  description: 'Mint all eligible rank NFTs' },

  // ── Chain / TX ──
  { id: 'tx_grind',      label: 'TX Grind (send)',    category: 'chain',  default: false, description: 'Send grind transactions to self' },
  { id: 'tx_receive',    label: 'Receive Quest',      category: 'chain',  default: false, description: 'Complete receive-transaction quest' },
  { id: 'tx_burn',       label: 'Burn DACC for QE',   category: 'chain',  default: false, description: 'Burn DACC to earn QE points' },
  { id: 'tx_stake',      label: 'Stake DACC',         category: 'chain',  default: false, description: 'Stake DACC in exchange contract' },

  // ── Strategy ──
  { id: 'strategy_run',  label: 'Smart Strategy',     category: 'strategy', default: false, description: 'Safe auto plan: keeps 0.50 DACC, then handles TX, stake, burn, crates, mint scan' },
];

const CATEGORIES = {
  tasks:    { label: 'Social Tasks',   order: 1 },
  badges:   { label: 'Badges',         order: 2 },
  rewards:  { label: 'Rewards',        order: 3 },
  minting:  { label: 'Minting',        order: 4 },
  chain:    { label: 'Chain / TX',     order: 5 },
  strategy: { label: 'Strategy',       order: 6 },
};

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function readFeaturesFile() {
  try { return JSON.parse(fs.readFileSync(FEATURES_FILE, 'utf8')); } catch { return null; }
}

function writeFeaturesFile(state) {
  ensureDir(path.dirname(FEATURES_FILE));
  fs.writeFileSync(FEATURES_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function buildDefaultState() {
  return Object.fromEntries(FEATURE_REGISTRY.map((f) => [f.id, f.default]));
}

function loadFeatureState() {
  const saved = readFeaturesFile();
  if (!saved || typeof saved !== 'object') return buildDefaultState();
  const defaults = buildDefaultState();
  // Merge: keep saved values, add any new features from registry
  return { ...defaults, ...saved };
}

function saveFeatureState(state) {
  writeFeaturesFile(state);
}

function getFeature(featureId) {
  return FEATURE_REGISTRY.find((f) => f.id === featureId) || null;
}

function isEnabled(featureId, state) {
  const feature = getFeature(featureId);
  const defaultValue = feature ? feature.default : true;
  if (!state || typeof state !== 'object') return defaultValue;
  return Object.prototype.hasOwnProperty.call(state, featureId) ? state[featureId] !== false : defaultValue;
}

function getFeaturesByCategory(state) {
  const groups = {};
  for (const cat of Object.keys(CATEGORIES)) groups[cat] = [];
  for (const feat of FEATURE_REGISTRY) {
    groups[feat.category].push({ ...feat, enabled: isEnabled(feat.id, state) });
  }
  return Object.entries(groups)
    .sort(([a], [b]) => CATEGORIES[a].order - CATEGORIES[b].order)
    .map(([cat, items]) => ({ category: cat, label: CATEGORIES[cat].label, items }));
}

function getEnabledFeatures(state) {
  return FEATURE_REGISTRY.filter((f) => isEnabled(f.id, state)).map((f) => f.id);
}

function getCategoryStatus(state) {
  const groups = getFeaturesByCategory(state);
  return groups.map((g) => ({
    category: g.category,
    label: g.label,
    enabled: g.items.filter((i) => i.enabled).length,
    total: g.items.length,
  }));
}

function buildAutoAllOptionsFromState(state) {
  return {
    tasks:    isEnabled('task_signin', state) || isEnabled('task_sync', state) || isEnabled('task_telegram', state) || isEnabled('task_x_follow', state),
    badges:   isEnabled('badge_claim', state),
    faucet:   isEnabled('faucet_claim', state),
    crates:   isEnabled('crate_open', state),
    mintScan: isEnabled('mint_scan', state),
    mintClaim: isEnabled('mint_claim', state),
    txGrind:  isEnabled('tx_grind', state),
    receive:  isEnabled('tx_receive', state),
    stake:    isEnabled('tx_stake', state),
    burn:     isEnabled('tx_burn', state),
    strategy: isEnabled('strategy_run', state),
  };
}

module.exports = {
  FEATURE_REGISTRY,
  CATEGORIES,
  loadFeatureState,
  saveFeatureState,
  getFeature,
  isEnabled,
  getFeaturesByCategory,
  getEnabledFeatures,
  getCategoryStatus,
  buildAutoAllOptionsFromState,
  buildDefaultState,
};
