#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { ethers } = require('ethers');
const { createApiClient } = require('../api/client');
const apiEndpoints = require('../api/endpoints');
const authSession = require('../auth/session');
const walletAuth = require('../auth/wallet-auth');
const statusDomain = require('../domain/status');
const { resolveAccountProxy, createConfiguredProxyRotation } = require('../addons/proxies');
const { StepTracker } = require('../tui/tracker');

const BASE_URL = 'https://inception.dachain.io';
const API_BASE = `${BASE_URL}/api/inception`;
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dac-bot-v3');
const APP_CONFIG_FILE = path.join(process.cwd(), 'dac.config.json');
const STRATEGY_FILE = path.join(CONFIG_DIR, 'strategy.json');
const MINT_CACHE_FILE = path.join(CONFIG_DIR, 'mint-status.json');
const CHILD_WALLETS_FILE = path.join(CONFIG_DIR, 'child-wallets.json');
const TRACKING_FILE = path.join(CONFIG_DIR, 'tracking.json');
const CAMPAIGN_FILE = path.join(CONFIG_DIR, 'campaign.json');

const RPC_URL = 'https://rpctest.dachain.tech';
const EXPLORER_URL = 'https://exptest.dachain.tech';
const CHAIN_ID = 0x5586;
const EXCHANGE_CONTRACT = '0x3691A78bE270dB1f3b1a86177A8f23F89A8Cef24';
const NFT_CONTRACT = '0xB36ab4c2Bd6aCfC36e9D6c53F39F4301901Bd647';
const MIN_TRANSFER_GAS_PRICE_WEI = ethers.parseUnits('0.1', 'gwei');

let sharedProvider = null;

function getSharedProvider() {
  if (!sharedProvider) sharedProvider = new ethers.JsonRpcProvider(RPC_URL);
  return sharedProvider;
}

const EXCHANGE_ABI = [
  'function burnForQE() payable',
  'function stake() payable',
  'function unstake(uint256 amount)',
  'function claimFees()',
  'function pendingFees(address user) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function totalBurned() view returns (uint256)',
];

const NFT_ABI = [
  'function claimRank(uint8 rankId, bytes signature)',
  'function hasMinted(address,uint8) view returns (bool)',
];

const DEFAULT_HEADERS = {
  'content-type': 'application/json',
  referer: `${BASE_URL}/dashboard`,
  origin: BASE_URL,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

const USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

const CHALLENGE_PATTERNS = [
  'captcha', 'cloudflare', 'attention required', 'verify you are human',
  'unusual traffic', 'access denied', 'temporarily blocked', 'rate limit',
  'too many requests', 'bot detection', 'challenge-platform', 'ray-id',
  'threat', 'blocked', 'forbidden', 'challenge',
];

function pickRandom(list) { return list[Math.floor(Math.random() * list.length)]; }
function jitter(baseMs, variancePct = 40) { const variance = baseMs * (variancePct / 100); return Math.max(100, Math.round(baseMs + (Math.random() * 2 - 1) * variance)); }
function jitterRange(minMs, maxMs) { return Math.round(minMs + Math.random() * (maxMs - minMs)); }
function pickUserAgent() { return pickRandom(USER_AGENT_POOL); }
function isChallengeResponse(text) { const lower = String(text || '').toLowerCase(); return CHALLENGE_PATTERNS.some((needle) => lower.includes(needle)); }

const SAFETY_FILE = path.join(CONFIG_DIR, 'safety.json');

const { normalizeCookieDomain, extractSetCookieParts, mergeCookieStrings, parseSetCookieHeader, parseCookieString, buildCookieHeader } = authSession;

function deriveWalletAddress(privateKey) {
  if (!privateKey) return null;
  try { return new ethers.Wallet(privateKey).address; } catch { return null; }
}

const RANKS = [
  { id: 0, name: 'Cadet', qe: 0, badgeKey: 'rank_cadet' },
  { id: 1, name: 'Commando', qe: 1000, badgeKey: 'rank_commando' },
  { id: 2, name: 'Seal', qe: 2000, badgeKey: 'rank_seal' },
  { id: 3, name: 'Shadow Unit', qe: 5000, badgeKey: 'rank_shadow' },
  { id: 4, name: 'Vanguard', qe: 10000, badgeKey: 'rank_vanguard' },
  { id: 5, name: 'Sentinel', qe: 25000, badgeKey: 'rank_sentinel' },
  { id: 6, name: 'Sovereign', qe: 50000, badgeKey: 'rank_sovereign' },
  { id: 7, name: 'Warrior', qe: 100000, badgeKey: 'rank_warrior' },
  { id: 8, name: 'Architect', qe: 200000, badgeKey: 'rank_architect' },
  { id: 9, name: 'Interceptor', qe: 300000, badgeKey: 'rank_interceptor' },
  { id: 10, name: 'Phantom', qe: 400000, badgeKey: 'rank_phantom' },
  { id: 11, name: 'Cipher', qe: 500000, badgeKey: 'rank_cipher' },
  { id: 12, name: 'Crown', qe: 750000, badgeKey: 'rank_crown' },
];

const STRATEGY_PROFILES = {
  safe: { reserveDacc: '0.50', txAmount: '0.0001', txCount: 3, minBurnAmount: '0.02', minStakeAmount: '0.02', burnRatio: 0.15, stakeRatio: 0.15 },
  balanced: { reserveDacc: '0.25', txAmount: '0.0001', txCount: 3, minBurnAmount: '0.01', minStakeAmount: '0.01', burnRatio: 0.25, stakeRatio: 0.25 },
  aggressive: { reserveDacc: '0.15', txAmount: '0.0001', txCount: 4, minBurnAmount: '0.01', minStakeAmount: '0.01', burnRatio: 0.35, stakeRatio: 0.35 },
};

const DEFAULT_PROFILE = 'balanced';
const STRATEGY_DEFAULTS = STRATEGY_PROFILES[DEFAULT_PROFILE];

function defaultAppConfig() { return { default: null, accounts: {} }; }

function normalizeAppConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultAppConfig();
  if (raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)) {
    return { default: raw.default || null, accounts: raw.accounts };
  }
  if (raw.privateKey || raw.cookies || raw.csrf || raw.wallet) {
    return { default: raw.default || 'main', accounts: { main: { privateKey: raw.privateKey, cookies: raw.cookies, csrf: raw.csrf, wallet: raw.wallet, updated: raw.updated } } };
  }
  return { default: raw.default || null, accounts: Object.fromEntries(Object.entries(raw).filter(([key, value]) => key !== 'default' && value && typeof value === 'object' && !Array.isArray(value))) };
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function isSecretFile(file) {
  const resolved = path.resolve(file);
  const secretFiles = new Set([path.resolve(APP_CONFIG_FILE)]);
  return secretFiles.has(resolved);
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: isSecretFile(file) ? 0o600 : 0o644 });
}

function loadAppConfig() {
  const direct = readJson(APP_CONFIG_FILE, null);
  if (direct) return normalizeAppConfig(direct);
  return defaultAppConfig();
}

function saveAppConfig(config) {
  const normalized = normalizeAppConfig(config);
  const names = Object.keys(normalized.accounts);
  if (!normalized.default && names.length === 1) normalized.default = names[0];
  writeJson(APP_CONFIG_FILE, normalized);
  return normalized;
}

function currentSessionFile() { return APP_CONFIG_FILE; }
function currentAccountsFile() { return APP_CONFIG_FILE; }

function loadAccountsConfig() { return loadAppConfig(); }
function loadAccounts() { return loadAccountsConfig().accounts; }
function accountNames() { return Object.keys(loadAccounts()); }

function resolveDefaultAccountName(explicit = null) {
  if (explicit) return explicit;
  const config = loadAccountsConfig();
  return config.default || null;
}

function upsertAccount(name, payload, { makeDefault = false } = {}) {
  const config = loadAccountsConfig();
  const existing = config.accounts[name] || {};
  config.accounts[name] = { ...existing, ...payload };
  if (makeDefault || !config.default) config.default = name;
  return saveAppConfig(config);
}

function sanitizePositiveNumber(value, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = integer ? Math.trunc(parsed) : parsed;
  if (normalized < minimum || normalized > maximum) return fallback;
  return normalized;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function fmtNum(value, decimals = 6) { const n = Number(value); if (!Number.isFinite(n)) return String(value); return n.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '') || '0'; }
function shortAddr(addr) { return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '-'; }
function humanCooldown(seconds) { if (!seconds || seconds <= 0) return 'ready now'; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return `${hours ? `${hours}h ` : ''}${minutes}m`.trim(); }

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

function pickTransferFeeConfig(feeData) {
  if (feeData?.maxFeePerGas && feeData?.maxPriorityFeePerGas) return { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas };
  return { gasPrice: feeData?.gasPrice || ethers.parseUnits('1', 'gwei') };
}

function estimateTransferGasCost(feeData, gasLimit = 21000n) {
  if (feeData?.maxFeePerGas) return feeData.maxFeePerGas * gasLimit;
  if (feeData?.gasPrice) return feeData.gasPrice * gasLimit;
  return ethers.parseUnits('1', 'gwei') * gasLimit;
}

function humanFeaturesDefaults() { return { enabled: true, rotateUserAgent: true, jitterVariancePct: 20 }; }
function fastHumanFeaturesConfig() { return { enabled: false, rotateUserAgent: false, jitterVariancePct: 0 }; }
function humanFeaturesFile() { return path.join(CONFIG_DIR, 'human-features.json'); }
function loadHumanFeatures() { return { ...humanFeaturesDefaults(), ...(readJson(humanFeaturesFile(), {}) || {}) }; }
function saveHumanFeatures(config) { writeJson(humanFeaturesFile(), { ...humanFeaturesDefaults(), ...config }); }

function buildDefaultHeaders(userAgentOverride = null) {
  return { ...DEFAULT_HEADERS, 'user-agent': userAgentOverride || DEFAULT_HEADERS['user-agent'] };
}

function badgeTotalFromCatalog(catalog) {
  return Array.isArray(catalog?.badges) ? catalog.badges.length : 0;
}

function resolveBadgeTotal(...candidates) {
  for (const candidate of candidates) { const n = Number(candidate); if (Number.isInteger(n) && n > 0) return n; }
  return 0;
}

function formatErrorMessage(error) {
  if (!error) return 'Unknown error';
  const parts = [];
  if (error.shortMessage) parts.push(error.shortMessage);
  else if (error.reason) parts.push(error.reason);
  else if (error.message) parts.push(error.message);
  const code = error.code || error.info?.error?.code;
  if (code && !String(parts[0] || '').includes(String(code))) parts.push(`code=${code}`);
  const joined = parts.filter(Boolean).join(' | ');
  return joined.length > 220 ? `${joined.slice(0, 217)}...` : joined;
}

async function waitForTxReceipt(provider, hash, { attempts = 60, delayMs = 1000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await sleep(delayMs);
  }
  throw new Error(`Transaction ${hash} was not confirmed after ${attempts * delayMs}ms`);
}

async function buildLegacyTransferRequest(signer, provider, { to, value, gasLimit = 21000n }) {
  const [network, nonce, feeData] = await Promise.all([
    provider.getNetwork(),
    provider.getTransactionCount(signer.address, 'pending'),
    provider.getFeeData(),
  ]);
  const suggestedGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
  if (!suggestedGasPrice) throw new Error('Could not determine gas price for transfer');
  const gasPrice = suggestedGasPrice > MIN_TRANSFER_GAS_PRICE_WEI ? suggestedGasPrice : MIN_TRANSFER_GAS_PRICE_WEI;
  return { to, value, nonce, gasLimit, gasPrice, chainId: Number(network.chainId), type: 0 };
}

function collectRunStepPlan(options = {}) {
  const steps = [
    { key: 'sync', label: 'Sync account state' },
    { key: 'explore', label: 'Run exploration checks' },
  ];
  if (options.tasks) steps.push({ key: 'tasks', label: 'Complete social tasks' });
  if (options.badges) steps.push({ key: 'badges', label: 'Claim badges' });
  if (options.faucet) steps.push({ key: 'faucet', label: 'Claim faucet' });
  if (options.txGrind) steps.push({ key: 'txGrind', label: `Send TX x${options.txCount || STRATEGY_DEFAULTS.txCount}` });
  if (options.receive) steps.push({ key: 'receive', label: `Receive quest x${options.receiveCount || 1}` });
  if (options.mesh) steps.push({ key: 'mesh', label: `Mesh loop x${options.meshCount || 1}` });
  if (options.burnAmount) steps.push({ key: 'burn', label: `Burn ${options.burnAmount} DACC` });
  if (options.stakeAmount) steps.push({ key: 'stake', label: `Stake ${options.stakeAmount} DACC` });
  if (options.mintScan) steps.push({ key: 'mintScan', label: 'Scan mintable ranks' });
  if (options.crates) steps.push({ key: 'crates', label: 'Open crates' });
  return steps;
}

class DACBot {
  constructor({ cookies, csrf, privateKey, account, verbose = true, humanMode = true, fastMode = false, proxy = null, proxyRotation = null, tracker = null } = {}) {
    this.verbose = verbose;
    this.humanFeatures = fastMode ? fastHumanFeaturesConfig() : loadHumanFeatures();
    this.fastMode = fastMode;
    this.humanMode = humanMode !== false && this.humanFeatures.enabled !== false;
    this.provider = getSharedProvider();
    this.baseUrl = BASE_URL;
    this.apiBase = API_BASE;
    this.accountName = resolveDefaultAccountName(account);
    this.safety = readJson(SAFETY_FILE, null) || { suspendedUntil: null, lastReason: null, failureCount: 0, challengeCount: 0 };
    this.session = { cookies: '', csrf: '', cookieHeader: '', userAgent: pickUserAgent() };
    this.runtimeCache = {
      profile: { value: null, expiresAt: 0, pending: null },
      badgeCatalog: { value: null, expiresAt: 0, pending: null },
      network: { value: null, expiresAt: 0, pending: null },
      status: { value: null, expiresAt: 0, pending: null },
    };
    this.tracker = tracker || null;

    const appConfig = loadAppConfig();
    const saved = this.accountName && appConfig.accounts[this.accountName]
      ? appConfig.accounts[this.accountName]
      : (fs.existsSync(currentSessionFile()) ? readJson(currentSessionFile(), {}) : {});
    const accounts = appConfig.accounts || {};
    this.accountConfig = this.accountName && accounts[this.accountName] ? accounts[this.accountName] : {};
    this.proxyRotation = proxyRotation || null;
    if (this.accountConfig && typeof this.accountConfig === 'object') {
      const cookieText = String(this.accountConfig.cookies || '');
      if (cookieText.includes('...') || String(this.accountConfig.csrf || '').includes('...')) {
        this.accountConfig = {};
      }
    }

    this.privateKey = privateKey || this.accountConfig.privateKey || saved.privateKey || null;
    this.walletInitError = null;
    this.wallet = null;
    if (this.privateKey) {
      try { this.wallet = new ethers.Wallet(this.privateKey, this.provider); }
      catch (error) { this.walletInitError = error; }
    }
    this.walletAddress = this.wallet?.address || deriveWalletAddress(this.privateKey) || this.accountConfig.wallet || saved.wallet || null;
    const proxyAssignment = resolveAccountProxy(this.walletAddress || this.accountName, { accountConfig: this.accountConfig, proxy, proxyRotation: this.proxyRotation });
    this.proxy = proxyAssignment.proxy;
    this.proxySource = proxyAssignment.source;
    this.proxyKey = this.walletAddress || this.accountName;
    this.exchange = this.wallet ? new ethers.Contract(EXCHANGE_CONTRACT, EXCHANGE_ABI, this.wallet) : null;
    this.nft = this.wallet ? new ethers.Contract(NFT_CONTRACT, NFT_ABI, this.wallet) : null;
    if (this.walletInitError) {
      const reason = this.walletInitError?.message || 'invalid private key';
      throw new Error(`Account ${this.accountName || 'unknown'} has invalid private key: ${reason}`);
    }

    const sessionCookies = cookies || this.accountConfig.cookies || saved.cookies || null;
    const sessionCsrf = csrf || this.accountConfig.csrf || saved.csrf || null;
    this.session = { ...this.session, cookies: '', csrf: '', cookieHeader: '' };
    if (sessionCookies && sessionCsrf) this.setSession(sessionCookies, sessionCsrf, false);
    this.buildDefaultHeaders = buildDefaultHeaders;
    this.badgeTotalFromCatalog = badgeTotalFromCatalog;
    this.apiClient = createApiClient(this);
    this.endpoints = apiEndpoints.createEndpoints(this);
  }

  log(message) { if (this.verbose) console.log(message); }

  // ─── Step Tracking ────────────────────────────────────

  _trackAdd(label, detail = null) {
    if (!this.tracker) return null;
    return this.tracker.add(label, { detail });
  }

  _trackStart(stepId) {
    if (!this.tracker || !stepId) return;
    this.tracker.start(stepId);
  }

  _trackFinish(stepId, meta = {}) {
    if (!this.tracker || !stepId) return;
    this.tracker.finish(stepId, meta);
  }

  _trackFail(stepId, error) {
    if (!this.tracker || !stepId) return;
    this.tracker.fail(stepId, error);
  }

  _trackSkip(stepId, reason = null) {
    if (!this.tracker || !stepId) return;
    this.tracker.skip(stepId, reason);
  }

  _trackTx(stepId, { txHash, explorerUrl, amount } = {}) {
    if (!this.tracker || !stepId) return;
    this.tracker.setTx(stepId, { txHash, explorerUrl, amount });
  }

  async _track(label, fn, { detail = null, txMeta = false } = {}) {
    const step = this._trackAdd(label, detail);
    if (!step) return fn();
    this._trackStart(step.id);
    try {
      const result = await fn();
      const meta = {};
      if (txMeta && result?.hash) {
        meta.txHash = result.hash;
        meta.explorerUrl = `${EXPLORER_URL}/tx/${result.hash}`;
        meta.amount = result.amount || null;
      }
      this._trackFinish(step.id, meta);
      return result;
    } catch (error) {
      this._trackFail(step.id, error);
      throw error;
    }
  }

  async humanDelay(baseMs, variancePct = null) { if (!this.humanMode) return; const pct = variancePct ?? this.humanFeatures.jitterVariancePct ?? 40; await sleep(jitter(baseMs, pct)); }

  async humanPause(kind = 'default') {
    if (!this.humanMode) return;
    const ranges = { api: [150, 500], task: [200, 700], crate: [400, 1200], badge: [100, 350], tx: [400, 1200], scan: [50, 180], mint: [300, 1000], session: [250, 700], default: [150, 500] };
    const [min, max] = ranges[kind] || ranges.default;
    await sleep(jitterRange(min, max));
  }

  rotateUserAgent() { if (!this.humanMode || this.humanFeatures.rotateUserAgent === false) return; this.session.userAgent = pickUserAgent(); }
  enforceSafety() {
    if (!this.safety?.suspendedUntil) return false;
    if (new Date(this.safety.suspendedUntil) > new Date()) {
      throw new Error(`Safety cooldown active until ${this.safety.suspendedUntil}: ${this.safety.lastReason || 'unknown'}`);
    }
    return false;
  }

  recordFailure(reason, { challenge = false } = {}) {
    const fc = (this.safety?.failureCount || 0) + 1;
    const cc = (this.safety?.challengeCount || 0) + (challenge ? 1 : 0);
    const cooldownSeconds = challenge ? Math.min(3600, 300 * cc) : Math.min(900, 60 * fc);
    this.safety = { failureCount: fc, challengeCount: cc, lastReason: reason, suspendedUntil: new Date(Date.now() + cooldownSeconds * 1000).toISOString() };
    writeJson(SAFETY_FILE, this.safety);
    this.log(`  -- ${reason}; cooldown ${humanCooldown(cooldownSeconds)}`);
  }

  clearSafety() { this.safety = { suspendedUntil: null, lastReason: null, failureCount: 0, challengeCount: 0 }; writeJson(SAFETY_FILE, this.safety); }

  classifyResponse(status, payload, bodyText = '') {
    const text = `${payload?.error || ''} ${payload?.body || ''} ${bodyText || ''}`.trim();
    return { challenge: isChallengeResponse(text), rateLimited: status === 429 || /too many requests|rate limit/i.test(text), blocked: status === 403 || status === 503 || isChallengeResponse(text) };
  }

  persistSession(cookieString, csrf) {
    const payload = { cookies: cookieString, csrf, privateKey: this.privateKey || undefined, wallet: this.walletAddress || undefined, updated: new Date().toISOString() };
    if (this.accountName) { upsertAccount(this.accountName, payload, { makeDefault: true }); return; }
    writeJson(currentSessionFile(), payload);
  }

  setSession(cookieString, csrf, persist = true) {
    const mergedCookies = mergeCookieStrings(this.session?.cookies, cookieString);
    this.session = { cookies: mergedCookies, csrf, cookieHeader: buildCookieHeader(mergedCookies), userAgent: this.session?.userAgent || pickUserAgent() };
    this.invalidateRuntimeCache();
    if (persist) this.persistSession(mergedCookies, csrf);
  }

  invalidateRuntimeCache(keys = null) {
    const targets = keys && keys.length ? keys : Object.keys(this.runtimeCache || {});
    targets.forEach((key) => { if (!this.runtimeCache[key]) return; this.runtimeCache[key] = { value: null, expiresAt: 0, pending: null }; });
  }

  getCachedValue(key) { const entry = this.runtimeCache?.[key]; if (!entry || !entry.value) return null; if (entry.expiresAt <= Date.now()) return null; return entry.value; }

  async withCache(key, ttlMs, loader, { force = false } = {}) {
    if (!force) { const cached = this.getCachedValue(key); if (cached) return cached; const pending = this.runtimeCache?.[key]?.pending; if (pending) return pending; }
    const pending = (async () => { const value = await loader(); if (!this.runtimeCache[key]) this.runtimeCache[key] = { value: null, expiresAt: 0, pending: null }; this.runtimeCache[key].value = value; this.runtimeCache[key].expiresAt = Date.now() + ttlMs; this.runtimeCache[key].pending = null; return value; })();
    this.runtimeCache[key].pending = pending;
    try { return await pending; } catch (error) { this.runtimeCache[key].pending = null; throw error; }
  }

  buildStatusFromProfile(profile, catalog) { return statusDomain.buildStatusFromProfile(profile, catalog, { badgeTotalFromCatalog: this.badgeTotalFromCatalog }); }
  async fetchDashboardSnapshot(options = {}) { return statusDomain.fetchDashboardSnapshot(this, options); }
  isReadOnlyApiPath(apiPath) { return apiEndpoints.isReadOnlyApiPath(apiPath); }
  getApiTimeoutMs(apiPath) { return apiEndpoints.getApiTimeoutMs(apiPath); }
  getFallbackPayload(apiPath) { return apiEndpoints.getFallbackPayload(this, apiPath); }
  async fetchJsonResponse(response) { return this.apiClient.fetchJsonResponse(response); }
  async fetchApiPayload(apiPath, options = {}) { return apiEndpoints.fetchApiPayload(this, apiPath, options); }
  isAuthFailure(payload) { return this.apiClient.isAuthFailure(payload); }
  async fetchWithSession(url, options = {}) { return this.apiClient.fetchWithSession(url, options); }
  async walletLogin(force = false) { return walletAuth.walletLogin(this, { force, baseUrl: BASE_URL }); }
  async ensureSession(force = false) { return walletAuth.ensureSession(this, { force, currentSessionFile, currentAccountsFile }); }
  async api(method, apiPath, body, options = {}) { return apiEndpoints.api(this, method, apiPath, body, options); }

  profile(options = {}) { return this.endpoints.profile(options); }
  config() { return this.endpoints.config(); }
  sync() { return this.endpoints.sync(); }
  network(options = {}) { return this.endpoints.network(options); }
  badgeCatalog(options = {}) { return this.endpoints.badgeCatalog(options); }
  crateHistory() { return this.endpoints.crateHistory(); }
  qeHistory() { return this.endpoints.qeHistory(); }
  exchangeHistory() { return this.endpoints.exchangeHistory(); }
  completeTask(task, extra = {}) { return this.endpoints.completeTask(task, extra); }
  claimBadge(badgeKey) { return this.endpoints.claimBadge(badgeKey); }
  claimFaucet() { return this.endpoints.claimFaucet(); }
  faucetHistory() { return this.endpoints.faucetHistory(); }
  faucetStatus(dispenseId) { return this.endpoints.faucetStatus(dispenseId); }
  openCrate() { return this.endpoints.openCrate(); }
  visitPage(pathValue) { return this.endpoints.visitPage(pathValue); }
  visitExplorer() { return this.endpoints.visitExplorer(); }
  claimSignature(rankKey) { return this.endpoints.claimSignature(rankKey); }
  confirmMint(txHash, rankKey) { return this.endpoints.confirmMint(txHash, rankKey); }
  confirmBurn(txHash) { return this.endpoints.confirmBurn(txHash); }
  confirmStake(txHash) { return this.endpoints.confirmStake(txHash); }

  async status(options = {}) { return statusDomain.status(this, options); }

  async getNativeBalance(address = null) {
    const target = address || this.wallet?.address;
    if (!target) throw new Error('No wallet configured');
    return ethers.formatEther(await this.provider.getBalance(target));
  }

  createChildWallets(count = 3) {
    const wallets = [];
    for (let i = 0; i < count; i += 1) { const wallet = ethers.Wallet.createRandom(); wallets.push({ address: wallet.address, privateKey: wallet.privateKey, mnemonic: wallet.mnemonic?.phrase || null }); }
    const allChildWallets = readJson(CHILD_WALLETS_FILE, {});
    allChildWallets[this.accountName || 'default'] = { createdAt: new Date().toISOString(), wallets };
    writeJson(CHILD_WALLETS_FILE, allChildWallets);
    return { wallets, file: CHILD_WALLETS_FILE };
  }

  loadChildWallets() { const all = readJson(CHILD_WALLETS_FILE, {}); const data = all[this.accountName || 'default'] || {}; return Array.isArray(data.wallets) ? data.wallets : []; }

  async sendNative(to, amountEth) {
    if (!this.wallet) throw new Error('No private key configured');
    return this._track('Send native', async () => {
      const request = await buildLegacyTransferRequest(this.wallet, this.provider, { to, value: ethers.parseEther(String(amountEth)) });
      const tx = await this.wallet.sendTransaction(request);
      await waitForTxReceipt(this.provider, tx.hash);
      return { hash: tx.hash, amount: amountEth, to, explorer: `${EXPLORER_URL}/tx/${tx.hash}` };
    }, { detail: `${shortAddr(this.wallet.address)} → ${shortAddr(to)} ${amountEth} DACC`, txMeta: true });
  }

  async grindTransactions({ count = 3, amount = '0.0001', recipients = [] } = {}) {
    if (!this.wallet) throw new Error('No private key configured');
    if (!recipients.length) { const generated = this.createChildWallets(Math.max(count, 3)); recipients = generated.wallets.map((w) => w.address); this.log(`  Generated child wallets in ${generated.file}`); }
    const sent = [];
    for (let i = 0; i < Math.min(count, recipients.length); i += 1) {
      const to = recipients[i];
      const tx = await this.sendNative(to, amount);
      this.log(`  TX ${i + 1}: ${shortAddr(this.wallet.address)} -> ${shortAddr(to)} ${amount} DACC`);
      this.log(`     ${EXPLORER_URL}/tx/${tx.hash}`);
      sent.push({ to, amount, hash: tx.hash });
      await this.humanPause('tx');
    }
    const sync = await this.sync();
    await this.recordTaskCompletion('sync_tx', 'Sync transaction history');
    if (sent.length) await this.recordTaskCompletion('tx_first', 'Record first transaction');
    return { sent, sync };
  }

  async childWalletReceiveLoop({ count = 1, amount = '0.0001' } = {}) {
    if (!this.wallet) throw new Error('No private key configured');
    let children = this.loadChildWallets();
    if (children.length < count) { const generated = this.createChildWallets(Math.max(count, 3)); children = generated.wallets; this.log(`  Generated child wallets in ${generated.file}`); }
    const loops = [];
    const targets = children.slice(0, count);
    const amountWei = ethers.parseEther(String(amount));
    for (const child of targets) {
      const childSigner = new ethers.Wallet(child.privateKey, this.provider);
      const feeData = await this.provider.getFeeData();
      const gasLimit = 21000n;
      const gasCost = estimateTransferGasCost(feeData, gasLimit);
      const requiredWei = amountWei + gasCost;
      const before = await this.provider.getBalance(child.address);
      if (before < requiredWei) { const topUp = requiredWei - before; const fundRequest = await buildLegacyTransferRequest(this.wallet, this.provider, { to: child.address, value: topUp }); const fundTx = await this.wallet.sendTransaction(fundRequest); await waitForTxReceipt(this.provider, fundTx.hash); this.log(`  Funded child ${shortAddr(child.address)} with ${fmtNum(ethers.formatEther(topUp))} DACC`); }
      const childBalance = await this.provider.getBalance(child.address);
      const sendable = childBalance > gasCost ? childBalance - gasCost : 0n;
      if (sendable < amountWei) throw new Error(`Child wallet ${child.address} lacks enough balance to return funds after gas`);
      const returnAmount = sendable < amountWei ? sendable : amountWei;
      if (returnAmount <= 0n) throw new Error(`Child wallet ${child.address} has no safe return amount after gas`);
      const rxRequest = await buildLegacyTransferRequest(childSigner, this.provider, { to: this.wallet.address, value: returnAmount, gasLimit });
      const rxTx = await childSigner.sendTransaction(rxRequest);
      await waitForTxReceipt(this.provider, rxTx.hash);
      this.log(`  RX loop: ${shortAddr(child.address)} -> ${shortAddr(this.wallet.address)} ${fmtNum(ethers.formatEther(returnAmount))} DACC`);
      this.log(`     ${EXPLORER_URL}/tx/${rxTx.hash}`);
      loops.push({ via: 'child', from: child.address, to: this.wallet.address, amount: ethers.formatEther(returnAmount), hash: rxTx.hash });
      await this.humanPause('tx');
    }
    const sync = await this.sync();
    return { mode: 'child-wallets', received: loops, sync };
  }

  async receiveTransactions({ count = 1, amount = '0.0001', accounts = null } = {}) {
    if (!this.wallet) throw new Error('No private key configured');
    const allAccounts = accounts || loadAccounts();
    const candidates = Object.entries(allAccounts).filter(([name, cfg]) => name !== this.accountName && cfg && cfg.privateKey).map(([name, cfg]) => ({ name, cfg, wallet: deriveWalletAddress(cfg.privateKey) })).filter((row) => row.wallet && row.wallet.toLowerCase() !== this.wallet.address.toLowerCase());
    if (!candidates.length) { this.log('  No peer accounts with private keys found; falling back to child-wallet receive loop.'); const fallback = await this.childWalletReceiveLoop({ count, amount }); await this.recordTaskCompletion('tx_receive', 'Record received transaction'); return fallback; }
    const chosen = shuffle(candidates).slice(0, Math.min(count, candidates.length));
    const amountWei = ethers.parseEther(String(amount));
    const received = [];
    for (const peer of chosen) {
      const peerWallet = new ethers.Wallet(peer.cfg.privateKey, this.provider);
      const feeData = await this.provider.getFeeData();
      const gasLimit = 21000n;
      const gasCost = estimateTransferGasCost(feeData, gasLimit);
      const requiredWei = amountWei + gasCost;
      const balance = await this.provider.getBalance(peerWallet.address);
      if (balance < requiredWei) { const topUp = requiredWei - balance; const fundTx = await this.wallet.sendTransaction({ to: peerWallet.address, value: topUp }); await waitForTxReceipt(this.provider, fundTx.hash); this.log(`  Seeded peer ${peer.name} (${shortAddr(peerWallet.address)}) with ${fmtNum(ethers.formatEther(topUp))} DACC`); }
      const peerRequest = await buildLegacyTransferRequest(peerWallet, this.provider, { to: this.wallet.address, value: amountWei, gasLimit });
      const tx = await peerWallet.sendTransaction(peerRequest);
      await waitForTxReceipt(this.provider, tx.hash);
      this.log(`  RX mesh: ${peer.name} ${shortAddr(peerWallet.address)} -> ${shortAddr(this.wallet.address)} ${amount} DACC`);
      this.log(`     ${EXPLORER_URL}/tx/${tx.hash}`);
      received.push({ via: 'account', account: peer.name, from: peerWallet.address, to: this.wallet.address, amount, hash: tx.hash });
      await this.humanPause('tx');
    }
    const sync = await this.sync();
    await this.recordTaskCompletion('tx_receive', 'Record received transaction');
    return { mode: 'account-mesh', received, sync };
  }

  async txMesh({ count = 1, amount = '0.0001' } = {}) {
    const sent = await this.grindTransactions({ count, amount });
    const received = await this.receiveTransactions({ count, amount });
    const status = await this.status();
    return { sent, received, status };
  }

  async burnForQE(amountEth) {
    if (!this.exchange) throw new Error('No private key configured');
    return this._track(`Burn ${amountEth} DACC for QE`, async () => {
      this.log(`  Burn: submitting ${amountEth} DACC...`);
      const tx = await this.exchange.burnForQE({ value: ethers.parseEther(String(amountEth)) });
      this.log(`  Burn submitted: ${tx.hash}`);
      await waitForTxReceipt(this.provider, tx.hash);
      const confirm = await this.confirmBurn(tx.hash);
      this.invalidateRuntimeCache(['profile', 'status']);
      await this.recordTaskCompletion('first_swap', 'Record burn for QE');
      this.log(`  Burn confirmed: ${tx.hash}`);
      return { hash: tx.hash, amount: amountEth, confirm, explorer: `${EXPLORER_URL}/tx/${tx.hash}` };
    }, { detail: `${amountEth} DACC → QE`, txMeta: true });
  }

  async stakeDacc(amountEth) {
    if (!this.exchange) throw new Error('No private key configured');
    return this._track(`Stake ${amountEth} DACC`, async () => {
      this.log(`  Stake: submitting ${amountEth} DACC...`);
      const tx = await this.exchange.stake({ value: ethers.parseEther(String(amountEth)) });
      this.log(`  Stake submitted: ${tx.hash}`);
      await waitForTxReceipt(this.provider, tx.hash);
      const confirm = await this.confirmStake(tx.hash);
      this.invalidateRuntimeCache(['profile', 'status']);
      await this.recordTaskCompletion('liquidity', 'Record DACC stake');
      this.log(`  Stake confirmed: ${tx.hash}`);
      return { hash: tx.hash, amount: amountEth, confirm, explorer: `${EXPLORER_URL}/tx/${tx.hash}` };
    }, { detail: `${amountEth} DACC staked`, txMeta: true });
  }

  async recordTaskCompletion(taskKey, label, extra = {}) {
    const result = await this.completeTask(taskKey, extra);
    if (result.success) this.log(`  ${label}: +${result.qe_awarded ?? '?'} QE`);
    else if (result._status === 400 || String(result.error || '').toLowerCase().includes('already')) this.log(`  ${label}: done`);
    else this.log(`  ${label}: ${result.error || 'unknown error'}`);
    await this.humanPause('task');
    return result;
  }

  async runSocialTasks() {
    const tasks = [
      ['x_follow', 'Follow X @dac_chain'],
      ['telegram', 'Join Telegram'],
      ['signin', 'Sign in with wallet'],
      ['sync', 'Sync account state'],
      ['share_x', 'Share on X'],
      ['referral', 'Referral task'],
      ['email', 'Email task'],
      ['verify_email', 'Verify email'],
    ];
    for (const [taskKey, label] of tasks) {
      await this._track(label, async () => this.recordTaskCompletion(taskKey, label), { detail: taskKey });
    }
  }

  async runExploration() {
    const visits = [['/faucet', 'Visit faucet', 'exp_faucet'], ['/leaderboard', 'Visit leaderboard', 'exp_leaderboard'], ['/badges', 'Visit badge gallery', 'exp_badges']];
    for (const [pathValue, label, taskKey] of visits) {
      await this._track(label, async () => {
        const result = await this.visitPage(pathValue);
        if (result.success) this.log(`  ${label}`);
        else if (result._status === 400 || String(result.error || '').toLowerCase().includes('already')) this.log(`  ${label}: done`);
        else this.log(`  ${label}: ${result.error || 'unknown error'}`);
        if (taskKey) await this.recordTaskCompletion(taskKey, label);
        return result;
      }, { detail: pathValue });
    }
    await this._track('Visit explorer', async () => {
      const result = await this.visitExplorer();
      if (result.success && result.awarded) this.log('  Explorer visit: badge earned');
      else if (result.success) this.log('  Explorer: done');
      else this.log(`  Explorer: ${result.error || 'unknown error'}`);
      await this.recordTaskCompletion('exp_explorer', 'Visit explorer');
      return result;
    });
  }

  async runBadgeClaim() {
    return this._track('Claim badges', async () => {
      const profile = await this.profile({ force: true });
      if (!Array.isArray(profile.badges)) { this.log('  Could not read earned badges'); return { claimed: [], skippedEarned: [], skippedUnsupported: [], failed: [] }; }
      const earned = new Set(profile.badges.map((b) => b.badge__key || b.badge_key || b.key).filter(Boolean));
      const catalog = (await this.badgeCatalog({ force: true })).badges || [];
      const supportedCategories = new Set(['exploration', 'onboarding', 'social', 'milestone', 'onchain']);
      const claimed = [], skippedEarned = [], skippedUnsupported = [], failed = [];
      this.log(`  Badge detection: earned=${earned.size} catalog=${catalog.length}`);
      for (const badge of catalog) {
        const badgeKey = badge.key || badge.badge_key;
        if (!badgeKey) continue;
        if (earned.has(badgeKey)) { skippedEarned.push(badgeKey); continue; }
        if (!supportedCategories.has(badge.category)) { skippedUnsupported.push(badgeKey); continue; }
        const result = await this.claimBadge(badgeKey);
        if (result.success) { claimed.push({ key: badgeKey, name: badge.name, qe: result.qe_awarded ?? badge.qe_reward ?? 0 }); this.invalidateRuntimeCache(['profile', 'status']); this.log(`  ${badge.name}: +${result.qe_awarded ?? badge.qe_reward ?? 0} QE`); await this.humanPause('badge'); }
        else { failed.push({ key: badgeKey, name: badge.name, error: result.error || 'unknown error' }); this.log(`  ${badge.name}: ${result.error || 'unknown error'}`); }
      }
      this.log(`  Badge summary: claimed=${claimed.length} skipped-earned=${skippedEarned.length} skipped-unsupported=${skippedUnsupported.length} failed=${failed.length}`);
      if (claimed.length) this.log(`  Claimed: ${claimed.map((row) => row.name).join(', ')}`);
      if (failed.length) this.log(`  Failed: ${failed.map((row) => `${row.name} (${row.error})`).join('; ')}`);
      if (!claimed.length && !failed.length) this.log('  No claimable badges');
      return { claimed, skippedEarned, skippedUnsupported, failed };
    });
  }

  async runFaucet() {
    return this._track('Claim faucet', async () => {
      const result = await this.claimFaucet();
      if (result.success) { this.invalidateRuntimeCache(['profile', 'status']); this.log(`  Faucet: +${result.amount ?? '?'} DACC`); return result; }
      if (result.code === 'social_required') this.log('  Faucet: needs X or Discord link');
      else if (String(result.error || '').toLowerCase().includes('available in')) this.log(`  Faucet: ${result.error}`);
      else this.log(`  Faucet: ${result.error || 'unknown error'}`);
      return result;
    });
  }

  async runCrates(maxOpens = 5) {
    return this._track('Open crates', async () => {
      const history = await this.crateHistory();
      const opensToday = history.opens_today || 0;
      const dailyLimit = history.daily_open_limit || 5;
      const remaining = Math.min(Math.max(dailyLimit - opensToday, 0), maxOpens);
      if (remaining <= 0) { this.log(`  Crates: ${opensToday}/${dailyLimit} used today`); return []; }
      const results = [];
      this.log(`  Opening ${remaining} crates (${opensToday}/${dailyLimit} used)...`);
      for (let i = 0; i < remaining; i += 1) {
        const result = await this.openCrate();
        if (!result.success) { this.log(`    Crate ${i + 1}: ${result.error || 'unknown error'}`); break; }
        const reward = result.reward || {};
        this.invalidateRuntimeCache(['profile', 'status']);
        this.log(`    Crate ${i + 1}: ${reward.label || '?'} (+${reward.amount || 0} QE) -> ${result.new_total_qe ?? '?'} total`);
        results.push(result);
        await this.humanPause('crate');
      }
      return results;
    });
  }

  async getMintableRanks() {
    const status = await this.status();
    const profile = status?.profile || {};
    const badgeList = Array.isArray(profile.badges) ? profile.badges : [];
    const ownedBadges = new Set(badgeList.map((b) => b?.badge__key || b?.badge_key || b?.key).filter(Boolean));
    const qe = Number(status?.qe ?? 0);
    const degraded = !status || !status.profile;
    const rows = [];
    for (const rank of RANKS) {
      const badgeOwned = ownedBadges.has(rank.badgeKey);
      const eligibleByQe = qe >= rank.qe;
      let minted = false;
      if (this.nft && this.wallet) { try { minted = await this.nft.hasMinted(this.wallet.address, rank.id); } catch { minted = false; } }
      let backendReady = false, backendError = null, signature = null, chainId = null;
      if (badgeOwned || eligibleByQe) {
        const probe = await this.claimSignature(rank.badgeKey);
        backendReady = Boolean(probe.success && probe.signature);
        backendError = backendReady ? null : (probe.error || null);
        signature = probe.signature ? String(probe.signature).replace(/^0x/i, '') : null;
        chainId = probe.chain_id || null;
      }
      rows.push({ rankId: rank.id, rankName: rank.name, qeThreshold: rank.qe, badgeKey: rank.badgeKey, badgeOwned, eligibleByQe, minted, backendReady, backendError, signature, chainId, degraded, scanError: degraded ? 'status profile unavailable during mint scan' : null });
      await this.humanPause('scan');
    }
    writeJson(MINT_CACHE_FILE, { updatedAt: new Date().toISOString(), rows });
    return rows;
  }

  async mintRank(rankKey) {
    if (!this.wallet || !this.nft) throw new Error('No private key configured');
    const rank = RANKS.find((r) => r.badgeKey === rankKey);
    if (!rank) throw new Error(`Unknown rank key: ${rankKey}`);
    return this._track(`Mint ${rank.name}`, async () => {
      const sig = await this.claimSignature(rankKey);
      if (!sig.success || !sig.signature) throw new Error(sig.error || 'No mint signature returned');
      const normalizedSignature = String(sig.signature).replace(/^0x/i, '');
      const alreadyMinted = await this.nft.hasMinted(this.wallet.address, sig.rank_id);
      if (alreadyMinted) return { alreadyMinted: true, rankKey, rankId: sig.rank_id };
      const tx = await this.nft.claimRank(sig.rank_id, `0x${normalizedSignature}`);
      await waitForTxReceipt(this.provider, tx.hash);
      const confirm = await this.confirmMint(tx.hash, rankKey);
      await this.recordTaskCompletion('nft_minter', 'Record NFT mint');
      return { rankKey, rankId: sig.rank_id, hash: tx.hash, confirm, explorer: `${EXPLORER_URL}/tx/${tx.hash}` };
    }, { detail: rankKey, txMeta: true });
  }

  async mintRankWithRetry(rankKey, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try { const result = await this.mintRank(rankKey); return { ok: true, attempt, ...result }; }
      catch (error) {
        lastError = error;
        try { const scan = await this.getMintableRanks(); const row = scan.find((item) => item.badgeKey === rankKey); if (row?.minted) return { ok: true, attempt, rankKey, recovered: true, alreadyMinted: true, rankId: row.rankId }; if (row && !row.backendReady && /already minted/i.test(row.backendError || '')) return { ok: true, attempt, rankKey, recovered: true, alreadyMinted: true, rankId: row.rankId }; } catch {}
        if (/Already minted/i.test(error.message || '')) return { ok: true, attempt, rankKey, recovered: true, alreadyMinted: true };
        if (attempt < attempts) { const delay = this.fastMode ? 0 : attempt * 1500; if (delay > 0) { this.log(`  Mint ${rankKey} failed on attempt ${attempt}/${attempts}: ${error.message}`); this.log(`     Retrying after ${delay}ms...`); await sleep(delay); } }
      }
    }
    return { ok: false, rankKey, error: lastError?.message || 'unknown mint failure' };
  }

  async mintAllEligibleRanks() {
    const rows = await this.getMintableRanks();
    const eligible = rows.filter((row) => row.backendReady && !row.minted);
    const results = [];
    for (const row of eligible) {
      const minted = await this.mintRankWithRetry(row.badgeKey, 3);
      results.push(minted);
      if (minted.ok) this.log(`  Minted ${row.rankName}${minted.attempt ? ` (attempt ${minted.attempt})` : ''}`);
      else this.log(`  Mint ${row.rankName}: ${minted.error}`);
      await this.humanPause('mint');
    }
    return { eligible: eligible.map((row) => row.badgeKey), results };
  }

  async leaderboard(limit = 10) { return this.api('GET', `/leaderboard/?limit=${limit}`); }

  async snapshotTracking() {
    const status = await this.status();
    const leaderboard = await this.leaderboard(25);
    const payload = { updatedAt: new Date().toISOString(), account: this.accountName || 'default', wallet: status.wallet, referralCode: status.profile?.referral_code || null, referralCount: status.profile?.referral_count || 0, userRank: status.rank, qe: status.qe, txCount: status.txCount, leaderboard: leaderboard.leaderboard || [] };
    const current = readJson(TRACKING_FILE, {});
    current[this.accountName || 'default'] = payload;
    writeJson(TRACKING_FILE, current);
    return payload;
  }

  async runCampaign(config = {}) {
    const campaign = { name: config.name || 'default-campaign', loops: config.loops || 1, intervalSeconds: config.intervalSeconds || 0, strategyProfile: config.strategyProfile || DEFAULT_PROFILE, actions: [] };
    for (let i = 0; i < campaign.loops; i += 1) {
      this.log(`\n=== Campaign loop ${i + 1}/${campaign.loops} ===`);
      const before = await this.status();
      const strategyPlan = await this.runStrategy({ profileName: campaign.strategyProfile });
      await this.run({ strategy: false, profile: campaign.strategyProfile, tasks: true, badges: true, faucet: true, crates: true, mintScan: true });
      const minted = await this.mintAllEligibleRanks();
      const tracking = await this.snapshotTracking();
      const after = await this.status();
      campaign.actions.push({ loop: i + 1, before: { qe: before.qe, rank: before.rank, txCount: before.txCount }, after: { qe: after.qe, rank: after.rank, txCount: after.txCount }, strategyPlan, minted, tracking });
      if (i < campaign.loops - 1 && campaign.intervalSeconds > 0 && !this.fastMode) { this.log(`Sleeping ${campaign.intervalSeconds}s before next campaign loop...`); await sleep(campaign.intervalSeconds * 1000); }
    }
    const allCampaigns = readJson(CAMPAIGN_FILE, {});
    allCampaigns[this.accountName || 'default'] = campaign;
    writeJson(CAMPAIGN_FILE, allCampaigns);
    return campaign;
  }

  buildStrategy(status, crateHistory, config) {
    const reserve = ethers.parseEther(String(config.reserveDacc));
    const balance = ethers.parseEther(String(status.dacc || '0'));
    const spendable = balance > reserve ? balance - reserve : 0n;
    const actions = [], notes = [];
    notes.push(`profile=${config.profileName} balance=${fmtNum(status.dacc)} reserve=${config.reserveDacc} spendable=${fmtNum(ethers.formatEther(spendable))}`);
    notes.push('decision order: tx grind -> stake/burn surplus -> crates');
    const txBudget = ethers.parseEther(String(config.txAmount)) * BigInt(config.txCount);
    const lowTxCount = status.txCount < 3;
    if (this.wallet && spendable >= txBudget && lowTxCount) actions.push({ type: 'tx-grind', count: config.txCount, amount: config.txAmount, reason: 'low transaction count; use minimal surplus to push tx badges first' });
    const remainingAfterTx = spendable > txBudget ? spendable - txBudget : spendable;
    const minStake = ethers.parseEther(String(config.minStakeAmount));
    const minBurn = ethers.parseEther(String(config.minBurnAmount));
    const stakeAmount = (remainingAfterTx * BigInt(Math.floor(config.stakeRatio * 10000))) / 10000n;
    const burnAmount = (remainingAfterTx * BigInt(Math.floor(config.burnRatio * 10000))) / 10000n;
    const maxSingleAction = ethers.parseEther('0.25');
    const cappedStake = stakeAmount > maxSingleAction ? maxSingleAction : stakeAmount;
    const cappedBurn = burnAmount > maxSingleAction ? maxSingleAction : burnAmount;
    if (this.wallet && cappedStake >= minStake) actions.push({ type: 'stake', amount: ethers.formatEther(cappedStake), reason: 'stake a capped share of surplus DACC for safer long-tail progression' });
    if (this.wallet && cappedBurn >= minBurn) actions.push({ type: 'burn', amount: ethers.formatEther(cappedBurn), reason: 'burn a capped share of surplus DACC to convert into QE without over-spending' });
    if (status.qe >= (crateHistory.cost_per_open || 150) && (crateHistory.opens_today || 0) < (crateHistory.daily_open_limit || 5)) actions.push({ type: 'crates', reason: 'QE is high enough and daily crate capacity remains' });
    return { actions, notes, config };
  }

  async runStrategy(configOverrides = {}) {
    const requestedProfile = configOverrides.profileName || DEFAULT_PROFILE;
    const profileDefaults = STRATEGY_PROFILES[requestedProfile] || STRATEGY_DEFAULTS;
    const allStrategies = readJson(STRATEGY_FILE, {});
    const persisted = allStrategies[this.accountName || 'default'] || {};
    const persistedProfile = persisted.profileName && !configOverrides.profileName ? persisted.profileName : requestedProfile;
    const effectiveProfileDefaults = STRATEGY_PROFILES[persistedProfile] || profileDefaults;
    const config = { ...effectiveProfileDefaults, ...persisted, ...configOverrides, profileName: persistedProfile };
    const status = await this.status();
    const crateHistory = await this.crateHistory();
    const plan = this.buildStrategy(status, crateHistory, config);
    this.log(`\n  Strategy: profile=${config.profileName} DACC=${fmtNum(status.dacc)} Reserve=${config.reserveDacc} QE/TX=${status.qe}/${status.txCount}`);
    if (!plan.actions.length) this.log('  No actions selected');
    else plan.actions.forEach((action, idx) => this.log(`  ${idx + 1}. ${action.type}${action.amount ? ` (${fmtNum(action.amount)} DACC)` : ''} -- ${action.reason}`));
    for (const action of plan.actions) {
      if (action.type === 'tx-grind') await this.grindTransactions({ count: action.count, amount: action.amount });
      else if (action.type === 'stake') { try { const result = await this.stakeDacc(action.amount); this.log(`  Stake tx: ${result.hash}`); } catch (error) { this.log(`  Stake skipped: ${formatErrorMessage(error)}`); } }
      else if (action.type === 'burn') { try { const result = await this.burnForQE(action.amount); this.log(`  Burn tx: ${result.hash}`); } catch (error) { this.log(`  Burn skipped: ${formatErrorMessage(error)}`); } }
      else if (action.type === 'crates') await this.runCrates();
    }
    allStrategies[this.accountName || 'default'] = config;
    writeJson(STRATEGY_FILE, allStrategies);
    return plan;
  }

  async run(options = {}) {
    const { crates = true, faucet = true, tasks = true, badges = true, txGrind = false, txCount = 3, txAmount = '0.0001', burnAmount = null, stakeAmount = null, strategy = false, profile = DEFAULT_PROFILE, mintScan = true, receive = false, receiveCount = 1, receiveAmount = txAmount, mesh = false, meshCount = 1, meshAmount = txAmount, progress = null } = options;

    // Backward-compat progress callback
    const plannedSteps = collectRunStepPlan({ crates, faucet, tasks, badges, txGrind, txCount, burnAmount, stakeAmount, mintScan, receive, receiveCount, mesh, meshCount });
    let currentStep = 0;
    const advanceStep = (key, label, detail = null) => {
      const stepIndex = plannedSteps.findIndex((item) => item.key === key);
      currentStep = stepIndex >= 0 ? stepIndex + 1 : Math.min(currentStep + 1, plannedSteps.length || 1);
      if (progress) progress({ step: currentStep, total: plannedSteps.length || 1, label, detail, key });
    };

    await this.ensureSession(false);
    let strategyPlan = null;

    if (strategy) {
      advanceStep('strategy', `Strategy warmup (${profile})`);
      try {
        strategyPlan = await this._track(`Strategy warmup (${profile})`, async () => {
          this.log('\n  Strategy warmup...');
          const plan = await this.runStrategy({ profileName: profile, txCount, txAmount, ...(burnAmount ? { minBurnAmount: burnAmount } : {}), ...(stakeAmount ? { minStakeAmount: stakeAmount } : {}) });
          this.invalidateRuntimeCache(['profile', 'status']);
          return plan;
        });
      } catch (error) {
        this.log(`  Strategy: ${formatErrorMessage(error)}`);
      }
    }

    const before = await this._track('Fetch status', async () => {
      const s = await this.status();
      if (s.error) throw new Error(s.error);
      return s;
    });

    const network = await this._track('Fetch network', async () => {
      const n = await this.network();
      if (n.error) throw new Error(n.error);
      return n;
    });

    this.log(`\n  DAC INCEPTION BOT -- ${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`);
    this.log(`  QE=${before.qe ?? '?'} | DACC=${before.dacc ?? '?'} | #${before.rank ?? '?'} | ${before.badges ?? 0}/${resolveBadgeTotal(before.badgeTotal, 1)} badges | ${before.streak ?? 0}d streak | ${before.multiplier ?? 1}x`);
    this.log(`  Wallet: ${before.wallet || '-'} | tx_count=${before.txCount ?? 0}`);
    this.log(`  Network: blk=${network.block_number ?? '?'} tps=${network.tps ?? '?'} bt=${network.block_time ?? '?'}`);
    if (!before.faucetAvailable) this.log(`  Faucet cooldown: ${humanCooldown(before.faucetCooldownSeconds || 0)}`);
    if (this.wallet) this.log(`  Signer: ${this.wallet.address}`);

    await this._track('Sync account', async () => {
      advanceStep('sync', 'Sync account state');
      const sync = await this.sync();
      this.invalidateRuntimeCache(['profile', 'status']);
      if (sync.success) this.log(`  DACC=${sync.dacc_balance}, txns=${sync.tx_count}`);
      else this.log(`  Sync: ${sync.error || 'unknown error'}`);
      return sync;
    });

    await this._track('Exploration', async () => {
      advanceStep('explore', 'Run exploration checks');
      this.log('\n  Exploration...');
      return this.runExploration();
    });

    if (tasks) {
      advanceStep('tasks', 'Complete social tasks');
      this.log('\n  Tasks...');
      try { await this.runSocialTasks(); } catch (error) { this.log(`  Tasks: ${formatErrorMessage(error)}`); }
    }

    if (badges) {
      advanceStep('badges', 'Claim badges');
      this.log('\n  Badges...');
      try { await this.runBadgeClaim(); } catch (error) { this.log(`  Badges: ${formatErrorMessage(error)}`); }
    }

    if (faucet) {
      advanceStep('faucet', 'Claim faucet');
      this.log('\n  Faucet...');
      try { await this.runFaucet(); } catch (error) { this.log(`  Faucet: ${formatErrorMessage(error)}`); }
    }

    if (txGrind) {
      advanceStep('txGrind', `Send TX x${txCount}`);
      this.log('\n  TX Grind...');
      try { await this.grindTransactions({ count: txCount, amount: txAmount }); } catch (error) { this.log(`  TX Grind: ${formatErrorMessage(error)}`); }
    }

    if (receive) {
      advanceStep('receive', `Receive quest x${receiveCount}`);
      this.log('\n  Receive quest...');
      try { await this.receiveTransactions({ count: receiveCount, amount: receiveAmount }); } catch (error) { this.log(`  Receive: ${formatErrorMessage(error)}`); }
    }

    if (mesh) {
      advanceStep('mesh', `Mesh loop x${meshCount}`);
      this.log('\n  Send + receive mesh...');
      try { await this.txMesh({ count: meshCount, amount: meshAmount }); } catch (error) { this.log(`  Mesh: ${formatErrorMessage(error)}`); }
    }

    if (burnAmount) {
      advanceStep('burn', `Burn ${burnAmount} DACC`);
      this.log('\n  Burn for QE...');
      try { const result = await this.burnForQE(burnAmount); this.log(`  Burn tx: ${result.hash}`); } catch (error) { this.log(`  Burn: ${formatErrorMessage(error)}`); }
    }

    if (stakeAmount) {
      advanceStep('stake', `Stake ${stakeAmount} DACC`);
      this.log('\n  Stake DACC...');
      try { const result = await this.stakeDacc(stakeAmount); this.log(`  Stake tx: ${result.hash}`); } catch (error) { this.log(`  Stake: ${formatErrorMessage(error)}`); }
    }

    if (mintScan) {
      advanceStep('mintScan', 'Scan and auto-mint eligible ranks');
      this.log('\n  Mint Scan...');
      try {
        const mintRows = await this.getMintableRanks();
        const mintable = mintRows.filter((r) => r.backendReady && !r.minted);
        this.log(`  ${mintable.length ? `Potentially mintable ranks: ${mintable.map((r) => r.rankName).join(', ')}` : 'No backend-ready rank mints detected yet'}`);
        if (mintable.length) { this.log('\n  Auto-minting backend-ready ranks...'); const minted = await this.mintAllEligibleRanks(); const okCount = (minted.results || []).filter((row) => row.ok).length; const failCount = (minted.results || []).filter((row) => !row.ok).length; this.log(`  Auto-mint complete: ${okCount} success, ${failCount} failed`); this.invalidateRuntimeCache(['profile', 'status']); }
      } catch (error) { this.log(`  Mint Scan: ${formatErrorMessage(error)}`); }
    }

    if (crates) {
      advanceStep('crates', 'Open crates');
      this.log('\n  Crates...');
      try { await this.runCrates(); } catch (error) { this.log(`  Crates: ${formatErrorMessage(error)}`); }
    }

    const after = await this._track('Final status', async () => {
      const s = await this.status();
      this.log(`\n  FINAL: QE=${s.qe} | DACC=${s.dacc} | #${s.rank} | ${s.badges} badges | tx_count=${s.txCount}\n`);
      return s;
    });

    return { ok: true, strategyPlan, after };
  }
}

module.exports = {
  DACBot,
  waitForTxReceipt,
  buildLegacyTransferRequest,
  collectRunStepPlan,
  formatErrorMessage,
  deriveWalletAddress,
  loadAppConfig,
  loadAccounts,
  accountNames,
  loadAccountsConfig,
  resolveDefaultAccountName,
  upsertAccount,
  createConfiguredProxyRotation,
  shortAddr,
  fmtNum,
  humanCooldown,
  resolveBadgeTotal,
  sleep,
  readJson,
  writeJson,
  STRATEGY_DEFAULTS,
  STRATEGY_PROFILES,
  DEFAULT_PROFILE,
  RANKS,
  CONFIG_DIR,
  BASE_URL,
  EXPLORER_URL,
};
