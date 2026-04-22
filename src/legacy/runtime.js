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

const BASE_URL = 'https://inception.dachain.io';
const API_BASE = `${BASE_URL}/api/inception`;
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dac-bot-v3');
const APP_CONFIG_FILE = path.join(process.cwd(), 'dac.config.json');
const LEGACY_SESSION_FILE = path.join(CONFIG_DIR, 'session.json');
const LEGACY_ACCOUNTS_FILE = path.join(CONFIG_DIR, 'accounts.json');
const STRATEGY_FILE = path.join(CONFIG_DIR, 'strategy.json');
const MINT_CACHE_FILE = path.join(CONFIG_DIR, 'mint-status.json');
const CHILD_WALLETS_FILE = path.join(CONFIG_DIR, 'child-wallets.json');
const TRACKING_FILE = path.join(CONFIG_DIR, 'tracking.json');
const CAMPAIGN_FILE = path.join(CONFIG_DIR, 'campaign.json');

function defaultAppConfig() {
  return {
    default: null,
    accounts: {},
  };
}

function normalizeAppConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultAppConfig();
  if (raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)) {
    return {
      default: raw.default || null,
      accounts: raw.accounts,
    };
  }
  if (raw.privateKey || raw.cookies || raw.csrf || raw.wallet) {
    return {
      default: raw.default || 'main',
      accounts: {
        main: {
          privateKey: raw.privateKey,
          cookies: raw.cookies,
          csrf: raw.csrf,
          wallet: raw.wallet,
          updated: raw.updated,
        },
      },
    };
  }
  return {
    default: raw.default || null,
    accounts: Object.fromEntries(
      Object.entries(raw).filter(([key, value]) => key !== 'default' && value && typeof value === 'object' && !Array.isArray(value)),
    ),
  };
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

function currentSessionFile() {
  return APP_CONFIG_FILE;
}

function currentAccountsFile() {
  return APP_CONFIG_FILE;
}

const RPC_URL = 'https://rpctest.dachain.tech';
const EXPLORER_URL = 'https://exptest.dachain.tech';
const CHAIN_ID = 0x5586;
const EXCHANGE_CONTRACT = '0x3691A78bE270dB1f3b1a86177A8f23F89A8Cef24';
const NFT_CONTRACT = '0xB36ab4c2Bd6aCfC36e9D6c53F39F4301901Bd647';
const MIN_TRANSFER_GAS_PRICE_WEI = ethers.parseUnits('0.1', 'gwei');

let sharedProvider = null;

function getSharedProvider() {
  // Let the RPC report the active network so signed transactions always use the
  // node's authoritative chain ID.
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

// ── HUMAN FEATURES ─────────────────────────────────────────────────────────
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

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function jitter(baseMs, variancePct = 40) {
  const variance = baseMs * (variancePct / 100);
  return Math.max(100, Math.round(baseMs + (Math.random() * 2 - 1) * variance));
}

function jitterRange(minMs, maxMs) {
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

function pickUserAgent() {
  return pickRandom(USER_AGENT_POOL);
}

function isChallengeResponse(text) {
  const lower = String(text || '').toLowerCase();
  return CHALLENGE_PATTERNS.some((needle) => lower.includes(needle));
}

const SAFETY_FILE = path.join(CONFIG_DIR, 'safety.json');

const { normalizeCookieDomain, extractSetCookieParts, mergeCookieStrings, parseSetCookieHeader, parseCookieString, buildCookieHeader } = authSession;

function deriveWalletAddress(privateKey) {
  if (!privateKey) return null;
  try {
    return new ethers.Wallet(privateKey).address;
  } catch {
    return null;
  }
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
  safe: {
    reserveDacc: '0.50',
    txAmount: '0.0001',
    txCount: 3,
    minBurnAmount: '0.02',
    minStakeAmount: '0.02',
    burnRatio: 0.15,
    stakeRatio: 0.15,
  },
  balanced: {
    reserveDacc: '0.25',
    txAmount: '0.0001',
    txCount: 3,
    minBurnAmount: '0.01',
    minStakeAmount: '0.01',
    burnRatio: 0.25,
    stakeRatio: 0.25,
  },
  aggressive: {
    reserveDacc: '0.15',
    txAmount: '0.0001',
    txCount: 4,
    minBurnAmount: '0.01',
    minStakeAmount: '0.01',
    burnRatio: 0.35,
    stakeRatio: 0.35,
  },
};

const DEFAULT_PROFILE = 'balanced';
const STRATEGY_DEFAULTS = STRATEGY_PROFILES[DEFAULT_PROFILE];

const MENU_COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
};

function color(text, code) {
  return process.stdout.isTTY ? `${code}${text}${MENU_COLORS.reset}` : text;
}

function brandLines() {
  return [
    '██████  ██    ██     ███████ ███    ███ ██████  ███████ ██████   ██████  ██████',
    '██   ██  ██  ██      ██      ████  ████ ██   ██ ██      ██   ██ ██    ██ ██   ██',
    '██████    ████       █████   ██ ████ ██ ██████  █████   ██████  ██    ██ ██████',
    '██   ██    ██        ██      ██  ██  ██ ██      ██      ██   ██ ██    ██ ██   ██',
    '██████     ██        ███████ ██      ██ ██      ███████ ██   ██  ██████  ██   ██',
    '',
    '     ██  ██████  ██    ██ ██████  ███    ██  █████  ██      ███████',
    '     ██ ██    ██ ██    ██ ██   ██ ████   ██ ██   ██ ██      ██',
    '██   ██ ██    ██ ██    ██ ██████  ██ ██  ██ ███████ ██      ███████',
    '██   ██ ██    ██ ██    ██ ██   ██ ██  ██ ██ ██   ██ ██           ██',
    ' █████   ██████   ██████  ██   ██ ██   ████ ██   ██ ███████ ███████',
  ];
}

function printEmperorBanner() {
  printBrandWordmark();
}

function printBrandWordmark() {
  if (!process.stdout.isTTY) {
    console.log('BY EMPEROR JOURNALS');
    console.log('DAC INCEPTION BOT');
    return;
  }

  const titleWidth = resolveBoxWidth(96) - 2;
  const label = 'DAC INCEPTION BOT';
  const labelWidth = Math.max(label.length + 8, 34);
  const titleLines = brandLines();

  titleLines.forEach((line) => {
    const plain = stripAnsi(line);
    const centered = centerText(plain, titleWidth);
    const padded = padAnsi(centered, titleWidth).replace(centered, color(line, `${MENU_COLORS.bold}${MENU_COLORS.white}`));
    console.log(padded);
  });

  console.log('');
  console.log(color(`┌${'─'.repeat(labelWidth)}┐`, MENU_COLORS.cyan));
  const labelPaddingLeft = Math.floor((labelWidth - label.length) / 2);
  const labelPaddingRight = Math.max(0, labelWidth - label.length - labelPaddingLeft);
  const paddedLabel = `${' '.repeat(labelPaddingLeft)}${color(label, `${MENU_COLORS.bold}${MENU_COLORS.white}`)}${' '.repeat(labelPaddingRight)}`;
  console.log(`${color('│', MENU_COLORS.cyan)}${paddedLabel}${color('│', MENU_COLORS.cyan)}`);
  console.log(color(`└${'─'.repeat(labelWidth)}┘`, MENU_COLORS.cyan));
}

function printStartupBrand() {
  printBrandWordmark();
  console.log('');
}

function maybePrintStartupBrand() {
  printStartupBrand();
}

function humanFeaturesDefaults() {
  return {
    enabled: true,
    rotateUserAgent: true,
    jitterVariancePct: 20,
  };
}

function fastHumanFeaturesConfig() {
  return {
    enabled: true,
    rotateUserAgent: false,
    jitterVariancePct: 0,
  };
}

function humanFeaturesFile() {
  return path.join(CONFIG_DIR, 'human-features.json');
}

function loadHumanFeatures() {
  return { ...humanFeaturesDefaults(), ...(readJson(humanFeaturesFile(), {}) || {}) };
}

function saveHumanFeatures(config) {
  writeJson(humanFeaturesFile(), { ...humanFeaturesDefaults(), ...config });
}

function formatHumanFeaturesStatus(config) {
  return {
    enabled: !!config?.enabled,
    rotateUserAgent: !!config?.rotateUserAgent,
    jitterVariancePct: config?.jitterVariancePct,
  };
}

function buildDefaultHeaders(userAgentOverride = null) {
  return {
    ...DEFAULT_HEADERS,
    'user-agent': userAgentOverride || DEFAULT_HEADERS['user-agent'],
  };
}

function commandShowsBrand(command) {
  return !['human-status'].includes(command);
}

function maybePrintCommandBrand(command, { quiet = false } = {}) {
  if (quiet) return;
  if (commandShowsBrand(command)) maybePrintStartupBrand();
}

function humanFeaturesCommands() {
  return ['human-status', 'clear-safety'];
}

function printHumanFeaturesHint() {
  console.log(color('Human Features enabled: randomized timing, UA rotation, safety cooldowns.', MENU_COLORS.dim));
}

function printBrandAndHint(command) {
  maybePrintCommandBrand(command);
  if (command !== 'human-status') printHumanFeaturesHint();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function isSecretFile(file) {
  const resolved = path.resolve(file);
  const secretFiles = new Set([
    path.resolve(APP_CONFIG_FILE),
    path.resolve(currentSessionFile()),
    path.resolve(currentAccountsFile()),
    path.resolve(CHILD_WALLETS_FILE),
    path.resolve(SAFETY_FILE),
  ]);
  return secretFiles.has(resolved);
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: isSecretFile(file) ? 0o600 : 0o644 });
}

function sanitizePositiveNumber(value, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = integer ? Math.trunc(parsed) : parsed;
  if (normalized < minimum || normalized > maximum) return fallback;
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtNum(value, decimals = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '-';
}

function humanCooldown(seconds) {
  if (!seconds || seconds <= 0) return 'ready now';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}h ` : ''}${minutes}m`.trim();
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}


function pickTransferFeeConfig(feeData) {
  if (feeData?.maxFeePerGas && feeData?.maxPriorityFeePerGas) {
    return {
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    };
  }
  return {
    gasPrice: feeData?.gasPrice || ethers.parseUnits('1', 'gwei'),
  };
}

function estimateTransferGasCost(feeData, gasLimit = 21000n) {
  if (feeData?.maxFeePerGas) return feeData.maxFeePerGas * gasLimit;
  if (feeData?.gasPrice) return feeData.gasPrice * gasLimit;
  return ethers.parseUnits('1', 'gwei') * gasLimit;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    command: 'run',
    cookies: null,
    csrf: null,
    privateKey: null,
    account: null,
    interval: 360,
    txCount: 3,
    txAmount: '0.0001',
    burnAmount: null,
    stakeAmount: null,
    profile: DEFAULT_PROFILE,
    rankKey: null,
    noCrates: false,
    noFaucet: false,
    noTasks: false,
    noBadges: false,
    strategy: false,
    txGrind: false,
    quiet: false,
    help: false,
    fast: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--cookies') parsed.cookies = args[++i];
    else if (arg === '--csrf') parsed.csrf = args[++i];
    else if (arg === '--private-key') parsed.privateKey = args[++i];
    else if (arg === '--account') parsed.account = args[++i];
    else if (arg === '--interval') parsed.interval = Number(args[++i]);
    else if (arg === '--tx-count') parsed.txCount = Number(args[++i]);
    else if (arg === '--tx-amount') parsed.txAmount = args[++i];
    else if (arg === '--burn') parsed.burnAmount = args[++i];
    else if (arg === '--stake') parsed.stakeAmount = args[++i];
    else if (arg === '--profile') parsed.profile = args[++i];
    else if (arg === '--rank-key') parsed.rankKey = args[++i];
    else if (arg === '--strategy') parsed.strategy = true;
    else if (arg === '--tx-grind') parsed.txGrind = true;
    else if (arg === '--no-crates') parsed.noCrates = true;
    else if (arg === '--no-faucet') parsed.noFaucet = true;
    else if (arg === '--no-tasks') parsed.noTasks = true;
    else if (arg === '--no-badges') parsed.noBadges = true;
    else if (arg === '--quiet') parsed.quiet = true;
    else if (arg === '--fast') parsed.fast = true;
    else if (arg === '--no-human') parsed.humanMode = false;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  if (positional.length) parsed.command = positional[0];
  if (parsed.help) parsed.command = 'help';
  parsed.interval = sanitizePositiveNumber(parsed.interval, 360, { minimum: 1, maximum: 24 * 60, integer: true });
  parsed.txCount = sanitizePositiveNumber(parsed.txCount, 3, { minimum: 1, maximum: 100, integer: true });
  return parsed;
}

function printHelp() {
  console.log(`DAC Inception Bot

Usage:
  node bot.js run [options]
  node bot.js run-all [options]
  node bot.js manual [options]
  node bot.js strategy [options]
  node bot.js menu [options]
  node bot.js status [options]
  node bot.js setup --cookies "..." --csrf "..." [--private-key 0x...] [--account name]
  node bot.js loop --interval 360 [options]
  node bot.js tx-grind --tx-count 3 --tx-amount 0.0001 [options]
  node bot.js receive --tx-count 3 --tx-amount 0.0001 [options]
  node bot.js receive-all --tx-count 1 --tx-amount 0.0001 [options]
  node bot.js tx-mesh --tx-count 3 --tx-amount 0.0001 [options]
  node bot.js tx-mesh-all --tx-count 1 --tx-amount 0.0001 [options]
  node bot.js burn --burn 0.01 [options]
  node bot.js stake --stake 0.01 [options]
  node bot.js child-wallets --tx-count 5 [options]
  node bot.js mint-scan [options]
  node bot.js mint-rank --rank-key rank_cadet [options]
  node bot.js mint-all-ranks [options]
  node bot.js track [options]
  node bot.js campaign [options]
  node bot.js faucet-loop [options]
  node bot.js faucet-loop-all [options]
  node bot.js wallet-login [options]
  node bot.js human-status
  node bot.js clear-safety

Options:
  --cookies       Session cookie string
  --csrf          CSRF token
  --private-key   Private key for on-chain actions and wallet-auth refresh
  --account       Named account from dac.config.json
  --interval      Minutes between loop runs
  --tx-count      Transfer count for tx grinding / receive loops
  --tx-amount     Native amount per tx
  --burn          Burn amount in DACC
  --stake         Stake amount in DACC
  --profile       Strategy profile: safe | balanced | aggressive
  --rank-key      Rank key for NFT mint (e.g. rank_cadet)
  --duration-hours Total run time for faucet automation loops
  --strategy      Enable smart planner in run mode
  --tx-grind      Enable tx grinding in run mode
  --no-crates     Skip crates
  --no-faucet     Skip faucet
  --no-tasks      Skip API tasks
  --no-badges     Skip badge claiming
  --quiet         Less output
  --fast          Keep human mode on but use much shorter delays
  --no-human      Disable human-like timing and request patterns
`);
}

function prompt(question) {
  const cleanQuestion = String(question || '');
  const needsLeadingBreak = cleanQuestion.startsWith('\n');
  const promptText = needsLeadingBreak ? cleanQuestion.slice(1) : cleanQuestion;
  if (needsLeadingBreak) process.stdout.write('\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptYesNo(question, defaultValue = true) {
  const suffix = defaultValue ? ' [Y/n]: ' : ' [y/N]: ';
  const answer = (await prompt(`${question}${suffix}`)).toLowerCase();
  if (!answer) return defaultValue;
  if (['y', 'yes'].includes(answer)) return true;
  if (['n', 'no'].includes(answer)) return false;
  return defaultValue;
}

async function promptKeyword(question, allowed, defaultValue) {
  const hint = allowed.join('/');
  const answer = (await prompt(`${question} [${hint}]${defaultValue ? ` (${defaultValue})` : ''}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  if (allowed.includes(answer)) return answer;
  return defaultValue;
}

function clearLastLines(count) {
  if (!process.stdout.isTTY) return;
  for (let i = 0; i < count; i += 1) {
    readline.moveCursor(process.stdout, 0, -1);
    readline.clearLine(process.stdout, 0);
  }
  readline.cursorTo(process.stdout, 0);
}

function supportsRawMode(stream = process.stdin) {
  return !!(stream && typeof stream.setRawMode === 'function');
}

function stopRawMode(stream = process.stdin) {
  if (supportsRawMode(stream)) stream.setRawMode(false);
}

function startRawMode(stream = process.stdin) {
  if (supportsRawMode(stream)) stream.setRawMode(true);
}

async function promptSingleSelect(title, options, initialIndex = 0) {
  const safeIndex = Math.max(0, Math.min(initialIndex, options.length - 1));
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(color(String(title).toUpperCase(), `${MENU_COLORS.bold}${MENU_COLORS.white}`));
    options.forEach((option, idx) => {
      const marker = idx === safeIndex ? color('>', MENU_COLORS.cyan) : ' ';
      console.log(`${marker} ${String(idx + 1).padStart(2)}. ${option.label}`);
    });
    const answer = await prompt(`Choose option [${safeIndex + 1}]: `);
    if (!answer) return options[safeIndex]?.value ?? null;
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1]?.value ?? null;
    const matched = options.find((option) => option.value === answer);
    return matched?.value ?? options[safeIndex]?.value ?? null;
  }

  return new Promise((resolve, reject) => {
    let index = safeIndex;
    let rendered = 0;
    const render = () => {
      const lines = [
        color(String(title).toUpperCase(), `${MENU_COLORS.bold}${MENU_COLORS.white}`),
        color('Move with arrows, press Enter to open.', MENU_COLORS.dim),
        '',
      ];
      options.forEach((option, idx) => {
        const active = idx === index;
        const pointer = active ? color('›', MENU_COLORS.cyan) : color('·', MENU_COLORS.dim);
        const label = active ? color(option.label, `${MENU_COLORS.bold}${MENU_COLORS.white}`) : option.label;
        lines.push(`${pointer} ${String(idx + 1).padStart(2)}. ${label}`);
      });
      if (rendered) clearLastLines(rendered);
      process.stdout.write(`${lines.join('\n')}\n`);
      rendered = lines.length;
    };
    const cleanup = (value) => {
      stopRawMode(process.stdin);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      resolve(value);
    };
    const onData = (buf) => {
      const key = String(buf);
      if (key === '\u0003') {
        stopRawMode(process.stdin);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        reject(new Error('Interrupted'));
      }
      else if (key === '\u001b[A') { index = (index - 1 + options.length) % options.length; render(); }
      else if (key === '\u001b[B') { index = (index + 1) % options.length; render(); }
      else if (key === '\r') cleanup(options[index]?.value ?? null);
    };
    startRawMode(process.stdin);
    process.stdin.resume();
    process.stdin.on('data', onData);
    render();
  });
}

async function promptMultiToggle(title, items) {
  const state = items.map((item) => ({ ...item }));
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(color(String(title).toUpperCase(), `${MENU_COLORS.bold}${MENU_COLORS.white}`));
    console.log(color('Enter numbers separated by commas to toggle. Leave blank to keep defaults.', MENU_COLORS.dim));
    state.forEach((item, idx) => {
      const mark = item.checked ? color('[x]', MENU_COLORS.green) : color('[ ]', MENU_COLORS.dim);
      console.log(`${String(idx + 1).padStart(2)}. ${mark} ${item.label}`);
    });
    const answer = await prompt('Toggle items: ');
    if (!answer) return state.filter((item) => item.checked).map((item) => item.value);
    const toggledIndexes = Array.from(new Set(
      answer.split(',').map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length),
    ));
    if (!toggledIndexes.length) return state.filter((item) => item.checked).map((item) => item.value);
    toggledIndexes.forEach((toggleIndex) => {
      state[toggleIndex - 1].checked = !state[toggleIndex - 1].checked;
    });
    return state.filter((item) => item.checked).map((item) => item.value);
  }

  return new Promise((resolve, reject) => {
    let index = 0;
    let rendered = 0;
    const render = () => {
      const lines = [
        color(String(title).toUpperCase(), `${MENU_COLORS.bold}${MENU_COLORS.white}`),
        color('Move with arrows, Space toggles, Enter confirms.', MENU_COLORS.dim),
        '',
      ];
      state.forEach((item, idx) => {
        const active = idx === index;
        const pointer = active ? color('›', MENU_COLORS.cyan) : color('·', MENU_COLORS.dim);
        const mark = item.checked ? color('[x]', MENU_COLORS.green) : color('[ ]', MENU_COLORS.dim);
        const label = active ? color(item.label, `${MENU_COLORS.bold}${MENU_COLORS.white}`) : item.label;
        lines.push(`${pointer} ${String(idx + 1).padStart(2)}. ${mark} ${label}`);
      });
      if (rendered) clearLastLines(rendered);
      process.stdout.write(`${lines.join('\n')}\n`);
      rendered = lines.length;
    };
    const cleanup = () => {
      stopRawMode(process.stdin);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      resolve(state.filter((item) => item.checked).map((item) => item.value));
    };
    const onData = (buf) => {
      const key = String(buf);
      if (key === '\u0003') {
        stopRawMode(process.stdin);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        reject(new Error('Interrupted'));
      }
      else if (key === '\u001b[A') { index = (index - 1 + state.length) % state.length; render(); }
      else if (key === '\u001b[B') { index = (index + 1) % state.length; render(); }
      else if (key === ' ') { state[index].checked = !state[index].checked; render(); }
      else if (key === '\r') cleanup();
    };
    startRawMode(process.stdin);
    process.stdin.resume();
    process.stdin.on('data', onData);
    render();
  });
}

function progressBar(value, max, width = 18) {
  const safeMax = Math.max(Number(max) || 0, 1);
  const safeValue = Math.max(0, Math.min(Number(value) || 0, safeMax));
  const filled = Math.round((safeValue / safeMax) * width);
  const empty = Math.max(width - filled, 0);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function colorProgressBar(value, max, width = 18) {
  const bar = progressBar(value, max, width);
  const ratio = Math.max(0, Math.min((Number(value) || 0) / Math.max(Number(max) || 1, 1), 1));
  const tone = ratio >= 0.75 ? MENU_COLORS.green : ratio >= 0.4 ? MENU_COLORS.yellow : MENU_COLORS.red;
  return color(bar, tone);
}

function toneForRatio(value, max) {
  const ratio = Math.max(0, Math.min((Number(value) || 0) / Math.max(Number(max) || 1, 1), 1));
  if (ratio >= 0.75) return MENU_COLORS.green;
  if (ratio >= 0.4) return MENU_COLORS.yellow;
  return MENU_COLORS.red;
}

function renderMetric(label, value, width = 16, tone = MENU_COLORS.white) {
  const left = color(String(label).toUpperCase().padEnd(width), MENU_COLORS.dim);
  return `${left} ${color(String(value), tone)}`;
}

function renderPill(text, tone = MENU_COLORS.cyan) {
  return color(`● ${text}`, tone);
}

function renderLauncherStat(label, value, tone = MENU_COLORS.white) {
  return `${color(String(label).toUpperCase(), MENU_COLORS.dim)} ${color(String(value), tone)}`;
}

function wrapText(text, width) {
  const raw = String(text || '');
  if (!raw) return [''];
  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    if (visibleLength(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let remainder = word;
      while (visibleLength(remainder) > width) {
        lines.push(truncateAnsi(remainder, width));
        remainder = stripAnsi(remainder).slice(width);
      }
      current = remainder;
      return;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (visibleLength(candidate) <= width) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function flattenBoxLines(lines, width) {
  return lines.flatMap((line) => wrapText(line, width));
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(text) {
  return stripAnsi(text).length;
}

function truncateAnsi(text, maxWidth) {
  const raw = String(text);
  let visible = 0;
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\x1b') {
      const match = raw.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        out += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (visible >= maxWidth) break;
    out += ch;
    visible += 1;
  }
  return out;
}

function padAnsi(text, width) {
  const raw = String(text);
  const visible = visibleLength(raw);
  if (visible >= width) return truncateAnsi(raw, width);
  return `${raw}${' '.repeat(width - visible)}`;
}

function resolveBoxWidth(requested = 76) {
  const terminalWidth = process.stdout.isTTY ? (process.stdout.columns || requested) : requested;
  return Math.max(40, Math.min(requested, terminalWidth));
}

function printBox(title, lines, { width = 76, tone = MENU_COLORS.cyan } = {}) {
  const innerWidth = Math.max(resolveBoxWidth(width) - 2, 10);
  const expandedLines = flattenBoxLines(lines, innerWidth);
  console.log(color(`┌${'─'.repeat(innerWidth)}┐`, tone));
  console.log(`${color('│', tone)}${padAnsi(color(String(title).toUpperCase(), `${MENU_COLORS.bold}${tone}`), innerWidth)}${color('│', tone)}`);
  console.log(color(`├${'─'.repeat(innerWidth)}┤`, tone));
  expandedLines.forEach((line) => {
    console.log(`${color('│', tone)}${padAnsi(line, innerWidth)}${color('│', tone)}`);
  });
  console.log(color(`└${'─'.repeat(innerWidth)}┘`, tone));
}

function yn(flag) {
  return flag ? color('Y', MENU_COLORS.green) : color('N', MENU_COLORS.red);
}

function badgeTotalFromCatalog(catalog) {
  return Array.isArray(catalog?.badges) ? catalog.badges.length : 0;
}

function resolveBadgeTotal(...candidates) {
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 0;
}

function printQuestMatrix(rows) {
  const lines = [
    'acct       tg dc xf xl em fa | tasks | badges  | qe     rank',
    '---------- -- -- -- -- -- -- | ----- | ------- | ------ ------',
  ];
  rows.forEach((row) => {
    const r = row.result;
    const tasks = r.taskSummary || { done: 0, total: 0 };
    const acct = String(row.account).slice(0, 10).padEnd(10);
    const badgeTotal = resolveBadgeTotal(r.badgeTotal, rows[0]?.result?.badgeTotal, 1);
    const badgeText = `${r.badges}/${badgeTotal}`.padEnd(7);
    const qeText = String(r.qe ?? '-').padEnd(6);
    const rankText = String(r.rank ?? '-').padEnd(6);
    const faucetDone = !r.faucetAvailable && (r.faucetCooldownSeconds || 0) > 0;
    lines.push(`${acct} ${yn(r.telegramJoined)}  ${yn(r.discordLinked)}  ${yn(r.xFollowed)}  ${yn(r.xLinked)}  ${yn(r.emailVerified)}  ${yn(faucetDone)} | ${String(`${tasks.done}/${tasks.total}`).padEnd(5)} | ${badgeText} | ${qeText} ${rankText}`);
  });
  printBox('QUEST MATRIX', lines, { width: 76, tone: MENU_COLORS.cyan });
}

function centerText(text, width) {
  const raw = String(text);
  if (raw.length >= width) return raw.slice(0, width);
  const left = Math.floor((width - raw.length) / 2);
  const right = width - raw.length - left;
  return `${' '.repeat(left)}${raw}${' '.repeat(right)}`;
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

  return {
    to,
    value,
    nonce,
    gasLimit,
    gasPrice,
    chainId: Number(network.chainId),
    type: 0,
  };
}

function printLauncherHeader(status = null, network = null, bot = null) {
  printBrandWordmark();
  const badgeTotal = resolveBadgeTotal(status?.badgeTotal);
  const qeBar = colorProgressBar(status?.qe ?? 0, 10000, 14);
  const badgeBar = colorProgressBar(status?.badges ?? 0, badgeTotal || 1, 12);
  const badgeText = badgeTotal > 0 ? `${status?.badges ?? 0}/${badgeTotal}` : `${status?.badges ?? 0}/?`;
  const lines = [
    `${renderPill(`acct ${bot?.accountName || 'default'}`, MENU_COLORS.cyan)}  ${renderPill(status?.faucetAvailable ? 'faucet ready' : `faucet ${humanCooldown(status?.faucetCooldownSeconds || 0)}`, status?.faucetAvailable ? MENU_COLORS.green : MENU_COLORS.yellow)}  ${renderPill(`mode ${bot?.fastMode ? 'fast' : (bot?.humanMode === false ? 'direct' : 'human')}`, bot?.fastMode ? MENU_COLORS.magenta : MENU_COLORS.blue)}`,
    `${renderLauncherStat('Wallet', status?.wallet ? shortAddr(status.wallet) : 'loading', MENU_COLORS.white)}  ${renderLauncherStat('Rank', `#${status?.rank ?? '-'}`, MENU_COLORS.yellow)}`,
    `${renderLauncherStat('QE', `${status?.qe ?? '?'} ${qeBar}`, toneForRatio(status?.qe, 10000))}`,
    `${renderLauncherStat('Badges', `${badgeText} ${badgeBar}`, toneForRatio(status?.badges, badgeTotal || 1))}`,
    `${renderLauncherStat('Chain', `blk ${network?.block_number ?? '?'} | tps ${network?.tps ?? '?'} | bt ${network?.block_time ?? '?'}`, MENU_COLORS.white)}`,
  ];
  printBox('Command Deck', lines, { width: 88, tone: MENU_COLORS.blue });
}

function printSectionTitle(title) {
  console.log(color(`\n${title}`, MENU_COLORS.bold));
}

function printEmperorDeckTagline() {
  console.log(color('BY EMPEROR JOURNALS', `${MENU_COLORS.bold}${MENU_COLORS.white}`));
}

function loadAccountsConfig() {
  return loadAppConfig();
}

function loadAccounts() {
  return loadAccountsConfig().accounts;
}

function resolveDefaultAccountName(explicit = null) {
  if (explicit) return explicit;
  const config = loadAccountsConfig();
  return config.default || null;
}

function saveAccountsConfig(config) {
  return saveAppConfig(config);
}

function upsertAccount(name, payload, { makeDefault = false } = {}) {
  const config = loadAccountsConfig();
  const existing = config.accounts[name] || {};
  config.accounts[name] = { ...existing, ...payload };
  if (makeDefault || !config.default) config.default = name;
  return saveAccountsConfig(config);
}

function accountNames() {
  return Object.keys(loadAccounts());
}

async function runAcrossAccounts(taskName, runner, {
  selected = null,
  verbose = true,
  humanMode = true,
  fastMode = false,
  cookies = null,
  csrf = null,
  privateKey = null,
  proxyRotation = null,
  onAccountStart = null,
  onAccountComplete = null,
} = {}) {
  const names = selected && selected.length ? selected : accountNames();
  const summary = [];
  const sharedProxyRotation = proxyRotation || createConfiguredProxyRotation(loadAppConfig());

  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (onAccountStart) onAccountStart({ account: name, index, total: names.length, task: taskName });
    try {
      const bot = new DACBot({ account: name, verbose, humanMode, fastMode, cookies, csrf, privateKey, proxyRotation: sharedProxyRotation });
      const result = await runner(bot, name);
      summary.push({
        account: name,
        ok: true,
        task: taskName,
        proxy: bot.proxy ? { url: bot.proxy.url, label: bot.proxy.label, source: bot.proxySource } : null,
        result,
      });
      if (onAccountComplete) onAccountComplete({ account: name, index, total: names.length, task: taskName, ok: true, result });
    } catch (error) {
      summary.push({ account: name, ok: false, task: taskName, error: error.message });
      console.log(`❌ ${taskName} failed for ${name}: ${error.message}`);
      if (onAccountComplete) onAccountComplete({ account: name, index, total: names.length, task: taskName, ok: false, error: error.message });
    }
  }

  return { task: taskName, accounts: names, results: summary, updatedAt: new Date().toISOString() };
}

function printAccountSummary(orchestration) {
  console.log(`\n=== ${orchestration.task.toUpperCase()} SUMMARY ===`);
  orchestration.results.forEach((row) => {
    if (row.ok) console.log(`✅ ${row.account}`);
    else console.log(`❌ ${row.account}: ${row.error}`);
  });
}

function saveOrchestrationSnapshot(name, payload) {
  const file = path.join(CONFIG_DIR, `${name}.json`);
  writeJson(file, payload);
  return file;
}

async function orchestrateCampaignAll({ profile = DEFAULT_PROFILE, selected = null, verbose = true, humanMode = true, fastMode = false, proxyRotation = null } = {}) {
  const result = await runAcrossAccounts('campaign-all', async (bot) => {
    return bot.runCampaign({ loops: 1, strategyProfile: profile, intervalSeconds: 0 });
  }, { selected, verbose, humanMode, fastMode, proxyRotation });
  result.savedTo = saveOrchestrationSnapshot('campaign-all', result);
  return result;
}

async function orchestrateTrackAll({ selected = null, verbose = true, humanMode = true, fastMode = false, proxyRotation = null } = {}) {
  const result = await runAcrossAccounts('track-all', async (bot) => bot.snapshotTracking(), { selected, verbose, humanMode, fastMode, proxyRotation });
  result.savedTo = saveOrchestrationSnapshot('track-all', result);
  return result;
}

async function orchestrateMintAllRanks({ selected = null, verbose = true, humanMode = true, fastMode = false, proxyRotation = null } = {}) {
  const result = await runAcrossAccounts('mint-all-ranks-all', async (bot) => bot.mintAllEligibleRanks(), { selected, verbose, humanMode, fastMode, proxyRotation });
  result.savedTo = saveOrchestrationSnapshot('mint-all-ranks-all', result);
  return result;
}


async function runFaucetLoop(bot, { durationHours = 24, intervalMinutes = 60 } = {}) {
  const startedAt = Date.now();
  const until = startedAt + durationHours * 60 * 60 * 1000;
  const runs = [];
  let attempt = 0;
  while (Date.now() < until) {
    attempt += 1;
    const timestamp = new Date().toISOString();
    try {
      const result = await bot.runFaucet();
      runs.push({ attempt, timestamp, ok: !!result?.success, result });
    } catch (error) {
      runs.push({ attempt, timestamp, ok: false, error: error.message });
      bot.log(`  ❌ Faucet loop error: ${error.message}`);
    }
    if (Date.now() >= until) break;
    bot.log(`  💤 Faucet loop sleeping ${intervalMinutes}m`);
    await sleep(intervalMinutes * 60 * 1000);
  }
  return {
    account: bot.accountName || 'default',
    durationHours,
    intervalMinutes,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    runs,
  };
}

async function orchestrateFaucetLoopAll({ durationHours = 24, intervalMinutes = 60, selected = null, verbose = true, humanMode = true, fastMode = false, proxyRotation = null, onProgress = null } = {}) {
  const names = selected && selected.length ? selected : accountNames();
  const startedAt = Date.now();
  const until = startedAt + durationHours * 60 * 60 * 1000;
  const sharedProxyRotation = proxyRotation || createConfiguredProxyRotation(loadAppConfig());
  const perAccount = names.map((name) => ({
    account: name,
    bot: new DACBot({ account: name, verbose, humanMode, fastMode, proxyRotation: sharedProxyRotation }),
    runs: [],
  }));

  let cycle = 0;
  while (Date.now() < until) {
    cycle += 1;
    if (verbose) {
      console.log(`
=== FAUCET LOOP ALL | cycle ${cycle} | ${perAccount.length} accounts ===`);
    }
    for (let index = 0; index < perAccount.length; index += 1) {
      const entry = perAccount[index];
      if (Date.now() >= until) break;
      const timestamp = new Date().toISOString();
      if (typeof onProgress === 'function') {
        onProgress({ account: entry.account, cycle, status: 'running', detail: `cycle ${cycle} attempt ${index + 1}/${perAccount.length}` });
      }
      if (verbose) console.log(`→ [${index + 1}/${perAccount.length}] ${entry.account} | faucet attempt at ${timestamp}`);
      try {
        const result = await entry.bot.runFaucet();
        entry.runs.push({ cycle, timestamp, ok: !!result?.success, result });
        if (typeof onProgress === 'function') {
          onProgress({ account: entry.account, cycle, status: result?.success ? 'claimed' : 'skipped', detail: result?.success ? `+${result.amount ?? '?'} DACC` : (result?.error || result?.code || 'no reward') });
        }
        if (verbose) {
          if (result?.success) console.log(`  ✅ ${entry.account} claimed faucet (+${result.amount ?? '?'} DACC)`);
          else console.log(`  ⏭️  ${entry.account} ${result?.error || result?.code || 'no reward this round'}`);
        }
      } catch (error) {
        entry.runs.push({ cycle, timestamp, ok: false, error: error.message });
        if (typeof onProgress === 'function') {
          onProgress({ account: entry.account, cycle, status: 'failed', detail: error.message });
        }
        if (verbose) console.log(`  ❌ ${entry.account} ${error.message}`);
      }
    }
    if (Date.now() >= until) break;
    if (verbose) console.log(`💤 Completed cycle ${cycle}. Sleeping ${intervalMinutes}m before next round...`);
    await sleep(intervalMinutes * 60 * 1000);
  }

  const result = {
    task: 'faucet-loop-all',
    accounts: names,
    durationHours,
    intervalMinutes,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    results: perAccount.map((entry) => ({
      account: entry.account,
      ok: entry.runs.some((row) => row.ok),
      task: 'faucet-loop-all',
      proxy: entry.bot.proxy ? { url: entry.bot.proxy.url, label: entry.bot.proxy.label, source: entry.bot.proxySource } : null,
      result: {
        account: entry.account,
        durationHours,
        intervalMinutes,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        runs: entry.runs,
      },
    })),
    proxyState: sharedProxyRotation?.snapshot ? sharedProxyRotation.snapshot() : null,
    updatedAt: new Date().toISOString(),
  };
  result.savedTo = saveOrchestrationSnapshot('faucet-loop-all', result);
  return result;
}

async function orchestrateRunAll(options = {}) {
  const {
    selected = null,
    tasks = true,
    badges = true,
    faucet = false,
    crates = false,
    strategy = false,
    profile = DEFAULT_PROFILE,
    txGrind = false,
    txCount = STRATEGY_DEFAULTS.txCount,
    txAmount = STRATEGY_DEFAULTS.txAmount,
    mintScan = true,
    receive = false,
    receiveCount = 1,
    receiveAmount = STRATEGY_DEFAULTS.txAmount,
    mesh = false,
    meshCount = 1,
    meshAmount = STRATEGY_DEFAULTS.txAmount,
    verbose = true,
    humanMode = true,
    fastMode = false,
    cookies = null,
    csrf = null,
    privateKey = null,
    onAccountStart = null,
    onAccountComplete = null,
    progress = null,
  } = options;
  const result = await runAcrossAccounts('run-all', async (bot, account) => {
    return bot.run({
      tasks,
      badges,
      faucet,
      crates,
      strategy,
      profile,
      txGrind,
      txCount,
      txAmount,
      mintScan,
      receive,
      receiveCount,
      receiveAmount,
      mesh,
      meshCount,
      meshAmount,
      progress: progress ? (event) => progress({ account, ...event }) : null,
    });
  }, { selected, verbose, humanMode, fastMode, cookies, csrf, privateKey, onAccountStart, onAccountComplete });
  result.savedTo = saveOrchestrationSnapshot('run-all', result);
  return result;
}

function renderAutomationStepPanel({ account = null, step, total, label, detail = null }) {
  const lines = [
    `${renderMetric('Step', `${step}/${total}`, 12, MENU_COLORS.magenta)} ${colorProgressBar(step, total || 1, 28)}`,
    `${renderMetric('Now', label, 12, MENU_COLORS.white)}${detail ? ` ${color(detail, MENU_COLORS.dim)}` : ''}`,
  ];
  if (account) lines.unshift(`${renderMetric('Account', account, 12, MENU_COLORS.cyan)}`);
  printBox(`LIVE RUN :: STEP ${step}/${total}`, lines, { width: 88, tone: MENU_COLORS.magenta });
}

function getHoldProgress(daccValue) {
  const balance = Number(daccValue || 0);
  const tiers = [5, 10, 25, 50, 75, 100];
  const nextTarget = tiers.find((target) => balance < target) || tiers[tiers.length - 1];
  const previousTarget = tiers.slice().reverse().find((target) => balance >= target) || 0;
  return {
    balance,
    nextTarget,
    previousTarget,
    completed: tiers.filter((target) => balance >= target).length,
    total: tiers.length,
  };
}

function getReferralProgress(referralCount) {
  const count = Number(referralCount || 0);
  const tiers = [1, 3, 10, 25, 50];
  const nextTarget = tiers.find((target) => count < target) || tiers[tiers.length - 1];
  return {
    count,
    nextTarget,
    completed: tiers.filter((target) => count >= target).length,
    total: tiers.length,
  };
}

function renderLauncherOverview(status, network, bot, mode = null) {
  const badgeTotal = resolveBadgeTotal(status?.badgeTotal, 1);
  const tasksDone = buildTaskSummary(status?.profile || {}).done;
  const modeText = mode ? `selected ${mode}` : 'awaiting command';
  const hold = getHoldProgress(status?.dacc);
  const referral = getReferralProgress(status?.profile?.referral_count || 0);
  return [
    `${renderMetric('Operator', bot?.accountName || 'default', 12, MENU_COLORS.cyan)} ${renderMetric('Wallet', status?.wallet ? shortAddr(status.wallet) : '-', 10, MENU_COLORS.white)}`,
    `${renderMetric('QE', status?.qe ?? '?', 12, toneForRatio(status?.qe, 10000))} ${colorProgressBar(status?.qe ?? 0, 10000, 24)} ${renderMetric('Rank', `#${status?.rank ?? '-'}`, 8, MENU_COLORS.yellow)}`,
    `${renderMetric('Badges', `${status?.badges ?? 0}/${badgeTotal}`, 12, toneForRatio(status?.badges, badgeTotal || 1))} ${colorProgressBar(status?.badges ?? 0, badgeTotal || 1, 20)} ${renderMetric('Tasks', `${tasksDone}/6`, 8, MENU_COLORS.green)}`,
    `${renderMetric('Hold', `${fmtNum(hold.balance)}/${hold.nextTarget} DACC`, 12, toneForRatio(hold.completed, hold.total))} ${colorProgressBar(hold.completed, hold.total, 16)} ${renderMetric('Streak', `${status?.streak ?? 0}d`, 8, toneForRatio(status?.streak ?? 0, 30))}`,
    `${renderMetric('Referral', `${referral.count}/${referral.nextTarget}`, 12, toneForRatio(referral.completed, referral.total))} ${colorProgressBar(referral.completed, referral.total, 16)} ${renderMetric('Code', status?.profile?.referral_code || '-', 8, MENU_COLORS.white)}`,
    `${renderMetric('Chain', `blk ${network?.block_number || '?'} | tps ${network?.tps || '?'} | bt ${network?.block_time || '?'}`, 12, MENU_COLORS.white)}`,
    `${renderMetric('Faucet', status?.faucetAvailable ? 'ready now' : humanCooldown(status?.faucetCooldownSeconds || 0), 12, status?.faucetAvailable ? MENU_COLORS.green : MENU_COLORS.yellow)} ${renderMetric('Mode', modeText, 8, MENU_COLORS.magenta)}`,
  ];
}

function renderRunOptionsSummary(runOptions) {
  const flags = [
    runOptions.tasks ? renderPill('tasks', MENU_COLORS.green) : null,
    runOptions.badges ? renderPill('badges', MENU_COLORS.yellow) : null,
    runOptions.faucet ? renderPill('faucet', MENU_COLORS.blue) : null,
    runOptions.crates ? renderPill('crates', MENU_COLORS.magenta) : null,
    runOptions.mintScan ? renderPill('mint', MENU_COLORS.cyan) : null,
    runOptions.txGrind ? renderPill(`send x${runOptions.txCount}`, MENU_COLORS.white) : null,
    runOptions.receive ? renderPill(`receive x${runOptions.receiveCount}`, MENU_COLORS.green) : null,
    runOptions.stakeAmount ? renderPill(`stake ${runOptions.stakeAmount}`, MENU_COLORS.yellow) : null,
    runOptions.burnAmount ? renderPill(`burn ${runOptions.burnAmount}`, MENU_COLORS.red) : null,
    runOptions.strategy ? renderPill(`strategy ${runOptions.profile}`, MENU_COLORS.magenta) : null,
  ].filter(Boolean);
  return flags.length ? flags.join('  ') : color('No automation actions selected.', MENU_COLORS.dim);
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

function printAutomationReview(mode, accountLabel, runOptions) {
  const steps = collectRunStepPlan(runOptions);
  const lines = [
    `${renderMetric('Mode', mode === 'auto-all' ? 'Auto All' : 'Auto', 12, MENU_COLORS.cyan)} ${renderMetric('Target', accountLabel, 12, MENU_COLORS.white)}`,
    `${renderMetric('Step count', `${steps.length}`, 12, MENU_COLORS.magenta)} ${steps.map((step, index) => `${index + 1}.${step.label}`).join('  →  ')}`,
    `${renderMetric('Actions', 'enabled', 12, MENU_COLORS.green)} ${renderRunOptionsSummary(runOptions)}`,
  ];
  printBox('READY TO START AUTOMATION', lines, { width: 88, tone: MENU_COLORS.green });
}

function printAutoAllAccountBanner({ account, index, total, title = 'AUTO ALL' }) {
  printBox(`${title} :: ACCOUNT ${index + 1}/${total}`, [
    `${renderMetric('Now running', account, 14, MENU_COLORS.cyan)}`,
    `${renderMetric('Queue', `${index + 1} of ${total}`, 14, MENU_COLORS.magenta)} ${colorProgressBar(index + 1, total || 1, 28)}`,
  ], { width: 88, tone: MENU_COLORS.cyan });
}

function printSummaryLoadingBanner({ account, index, total }) {
  printAutoAllAccountBanner({ account, index, total, title: 'SUMMARY' });
  printBox('Loading Snapshot', [
    `${renderMetric('Status', 'fetching profile and progress', 14, MENU_COLORS.yellow)}`,
    `${renderMetric('Dashboard', 'building all-accounts view', 14, MENU_COLORS.white)}`,
  ], { width: 88, tone: MENU_COLORS.blue });
}

async function orchestrateReceiveAll({ selected = null, count = 1, amount = '0.0001', verbose = true, humanMode = true, fastMode = false } = {}) {
  const result = await runAcrossAccounts('receive-all', async (bot) => {
    return bot.receiveTransactions({ count, amount });
  }, { selected, verbose, humanMode, fastMode });
  result.savedTo = saveOrchestrationSnapshot('receive-all', result);
  return result;
}

async function orchestrateTxMeshAll({ selected = null, count = 1, amount = '0.0001', verbose = true, humanMode = true, fastMode = false } = {}) {
  const result = await runAcrossAccounts('tx-mesh-all', async (bot) => {
    return bot.txMesh({ count, amount });
  }, { selected, verbose, humanMode, fastMode });
  result.savedTo = saveOrchestrationSnapshot('tx-mesh-all', result);
  return result;
}

function buildTaskSummary(profile = {}) {
  const checks = [
    { key: 'telegramJoined', label: 'telegram', done: !!profile.telegram_joined },
    { key: 'discordLinked', label: 'discord', done: !!profile.discord_linked },
    { key: 'xLinked', label: 'x-linked', done: !!profile.x_linked },
    { key: 'xFollowed', label: 'x-follow', done: !!profile.x_followed },
    { key: 'emailVerified', label: 'email', done: !!profile.email_verified },
    { key: 'faucetClaimed', label: 'faucet', done: !profile.faucet_available && (profile.faucet_seconds_left || 0) > 0 },
  ];
  const done = checks.filter((item) => item.done);
  return {
    total: checks.length,
    done: done.length,
    labelsDone: done.map((item) => item.label),
  };
}

function printAccountsDashboard(orchestration) {
  const okRows = orchestration.results.filter((row) => row.ok && row.result);
  const failedRows = orchestration.results.filter((row) => !row.ok);
  const sorted = [...okRows].sort((a, b) => (b.result.qe || 0) - (a.result.qe || 0));
  const badgeFallback = okRows[0]?.result?.badgeTotal || 1;
  const totalQe = okRows.reduce((sum, row) => sum + Number(row.result.qe || 0), 0);
  const totalBadges = okRows.reduce((sum, row) => sum + Number(row.result.badges || 0), 0);
  const avgTasks = okRows.length ? okRows.reduce((sum, row) => sum + Number(row.result.taskSummary?.done || 0), 0) / okRows.length : 0;
  const avgReferrals = okRows.length ? okRows.reduce((sum, row) => sum + Number(row.result.referralCount || 0), 0) / okRows.length : 0;
  const pad = (value, width) => String(value ?? '-').slice(0, width).padEnd(width, ' ');
  const chunkRows = (rows, size) => {
    const groups = [];
    for (let index = 0; index < rows.length; index += size) groups.push(rows.slice(index, index + size));
    return groups;
  };

  console.log('');
  printBox('ALL ACCOUNTS DASHBOARD', [
    renderMetric('Accounts', `${okRows.length}/${orchestration.results.length} ok`),
    renderMetric('Total QE', totalQe, 16, MENU_COLORS.green),
    renderMetric('Badges', totalBadges, 16, MENU_COLORS.yellow),
    renderMetric('Avg tasks', avgTasks.toFixed(1)),
    renderMetric('Avg referrals', avgReferrals.toFixed(1), 16, MENU_COLORS.magenta),
    failedRows.length ? renderMetric('Failed', failedRows.map((row) => row.account).join(', '), 16, MENU_COLORS.red) : renderMetric('Failed', 'none', 16, MENU_COLORS.dim),
  ], { width: 88, tone: MENU_COLORS.cyan });

  if (sorted.length) {
    printBox('TOP ACCOUNTS', sorted.slice(0, 5).map((row, index) => {
      const r = row.result;
      const qeTone = toneForRatio(r.qe, 10000);
      return `${String(index + 1).padStart(2)}. ${row.account.padEnd(10)} | rank #${String(r.rank ?? '-').padEnd(6)} | QE ${color(String(r.qe ?? '-').padEnd(6), qeTone)} ${colorProgressBar(r.qe, 10000, 16)}`;
    }), { width: 88, tone: MENU_COLORS.cyan });
  }

  printQuestMatrix(okRows);

  const accountTableRows = okRows.map((row, index) => {
    const r = row.result;
    const tasks = r.taskSummary || { done: 0, total: 0 };
    const badgeTotal = resolveBadgeTotal(r.badgeTotal, badgeFallback, 1);
    const faucetText = r.faucetAvailable ? 'ready' : humanCooldown(r.faucetCooldownSeconds || 0);
    return [
      pad(String(index + 1).padStart(2, '0'), 4),
      pad(row.account, 12),
      pad(`#${r.rank ?? '-'}`, 7),
      pad(r.qe ?? '-', 8),
      pad(`${r.badges ?? 0}/${badgeTotal}`, 9),
      pad(`${tasks.done}/${tasks.total || 0}`, 7),
      pad(`${r.streak ?? 0}d`, 8),
      pad(r.referralCount || 0, 5),
      pad(faucetText, 12),
    ].join(' ');
  });

  chunkRows(accountTableRows, 10).forEach((group, index, groups) => {
    const lines = [
      'No.  Account      Rank    QE       Badges    Tasks   Streak   Ref   Faucet',
      ...group,
    ];
    printBox(groups.length > 1 ? `ACCOUNT SUMMARY ${index + 1}/${groups.length}` : 'ACCOUNT SUMMARY', lines, { width: 88, tone: MENU_COLORS.cyan });
  });

  if (failedRows.length) {
    printBox('FAILED ACCOUNTS', failedRows.map((row) => `${pad(row.account, 12)} ${row.error || 'unknown error'}`), { width: 88, tone: MENU_COLORS.red });
  }
}
async function orchestrateStatusAll({ selected = null, verbose = true, humanMode = true, fastMode = false, onAccountStart = null, onAccountComplete = null } = {}) {
  const result = await runAcrossAccounts('status-all', async (bot) => {
    const snapshot = await bot.fetchDashboardSnapshot();
    const { status } = snapshot;
    const profile = status.profile || {};
    return {
      wallet: status.wallet,
      qe: status.qe,
      dacc: status.dacc,
      rank: status.rank,
      txCount: status.txCount,
      badges: status.badges,
      badgeTotal: status.badgeTotal,
      streak: status.streak,
      multiplier: status.multiplier,
      faucetAvailable: status.faucetAvailable,
      faucetCooldownSeconds: status.faucetCooldownSeconds,
      referralCount: profile.referral_count || 0,
      referralCode: profile.referral_code || null,
      telegramJoined: !!profile.telegram_joined,
      discordLinked: !!profile.discord_linked,
      xFollowed: !!profile.x_followed,
      xLinked: !!profile.x_linked,
      emailVerified: !!profile.email_verified,
      taskSummary: buildTaskSummary(profile),
    };
  }, { selected, verbose, humanMode, fastMode, onAccountStart, onAccountComplete });
  result.savedTo = saveOrchestrationSnapshot('status-all', result);
  return result;
}

async function orchestrateCommand(command, args) {
  if (command === 'wallet-login-all') {
    const result = await runAcrossAccounts('wallet-login-all', async (bot) => {
      const auth = await bot.walletLogin(true);
      return { wallet: bot.walletAddress, auth };
    }, { verbose: !args.quiet, humanMode: args.humanMode !== false, fastMode: !!args.fast });
    result.savedTo = saveOrchestrationSnapshot('wallet-login-all', result);
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  if (command === 'faucet-loop-all') {
    const result = await orchestrateFaucetLoopAll({ durationHours: args.durationHours || 24, intervalMinutes: args.interval || 60, verbose: !args.quiet, humanMode: args.humanMode !== false, fastMode: !!args.fast });
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  if (command === 'campaign-all') {
    const result = await orchestrateCampaignAll({ profile: args.profile || DEFAULT_PROFILE, verbose: !args.quiet, humanMode: args.humanMode !== false, fastMode: !!args.fast });
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  if (command === 'track-all') {
    const result = await orchestrateTrackAll({ verbose: !args.quiet, humanMode: args.humanMode !== false, fastMode: !!args.fast });
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  if (command === 'mint-all-ranks-all') {
    const result = await orchestrateMintAllRanks({ verbose: !args.quiet, humanMode: args.humanMode !== false, fastMode: !!args.fast });
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  if (command === 'status-all') {
    const result = await orchestrateStatusAll({ verbose: !args.quiet, humanMode: args.humanMode !== false });
    printAccountsDashboard(result);
    return true;
  }
  if (command === 'run-all') {
    const result = await orchestrateRunAll({
      tasks: !args.noTasks,
      badges: !args.noBadges,
      faucet: !args.noFaucet,
      crates: !args.noCrates,
      strategy: !!args.strategy,
      profile: args.profile || DEFAULT_PROFILE,
      txGrind: !!args.txGrind,
      txCount: args.txCount,
      txAmount: args.txAmount,
      mintScan: true,
      verbose: !args.quiet,
      humanMode: args.humanMode !== false,
      fastMode: !!args.fast,
    }, { verbose: !args.quiet, humanMode: args.humanMode !== false, fastMode: !!args.fast });
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  if (command === 'receive-all') {
    const result = await orchestrateReceiveAll({ count: args.txCount, amount: args.txAmount, verbose: !args.quiet, humanMode: args.humanMode !== false });
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  if (command === 'tx-mesh-all') {
    const result = await orchestrateTxMeshAll({ count: args.txCount, amount: args.txAmount, verbose: !args.quiet, humanMode: args.humanMode !== false });
    printAccountSummary(result);
    console.log(JSON.stringify(result, null, 2));
    return true;
  }
  return false;
}

function hasAccountsConfigured() {
  return accountNames().length > 0;
}

function printAccountsConfigured() {
  const config = loadAccountsConfig();
  const defaultNote = config.default ? ` (default: ${config.default})` : '';
  console.log(`accounts configured: ${accountNames().join(', ') || '(none)'}${defaultNote}`);
}

function orchestrationCommands() {
  return ['wallet-login-all', 'status-all', 'track-all', 'mint-all-ranks-all', 'campaign-all', 'faucet-loop-all', 'run-all', 'receive-all', 'tx-mesh-all'];
}

function printOrchestrationHelp() {
  console.log('Multi-account commands:');
  orchestrationCommands().forEach((cmd) => console.log(`- node bot.js ${cmd}`));
}

function saveAccountsTemplate() {
  const template = {
    default: null,
    accounts: {},
  };
  if (!fs.existsSync(currentAccountsFile())) writeJson(currentAccountsFile(), template);
}

function ensureAccountFile() {
  ensureDir(CONFIG_DIR);
}

function accountOptionHelp() {
  return '--account <name>';
}

function printAccountOptionHelp() {
  console.log(`Named account option: ${accountOptionHelp()}`);
}

function accountBanner() {
  console.log(color('╔════════════════ MULTI-ACCOUNT ORCHESTRATOR ════════════════╗', MENU_COLORS.blue));
  console.log(color('╚═════════════════════════════════════════════════════════════╝', MENU_COLORS.blue));
}

function printAccountBanner() {
  accountBanner();
  printAccountsConfigured();
}

function shouldHandleOrchestration(command) {
  return orchestrationCommands().includes(command);
}

async function maybeHandleOrchestration(command, args) {
  if (!shouldHandleOrchestration(command)) return false;
  printAccountBanner();
  return orchestrateCommand(command, args);
}

function addAccountMenuHints() {
  console.log(color('Named accounts let you run the same workflow across many wallets/sessions.', MENU_COLORS.dim));
}

function printOrchestrationMenuLines() {
  console.log(`${color('14.', MENU_COLORS.magenta)} Wallet-login all accounts`);
  console.log(`${color('15.', MENU_COLORS.magenta)} Status all accounts`);
  console.log(`${color('16.', MENU_COLORS.magenta)} Track all accounts`);
  console.log(`${color('17.', MENU_COLORS.magenta)} Mint all eligible ranks across all accounts`);
  console.log(`${color('18.', MENU_COLORS.magenta)} Campaign all accounts`);
  console.log(`${color('19.', MENU_COLORS.magenta)} Faucet loop all accounts`);
  console.log(`${color('20.', MENU_COLORS.magenta)} Run automation across all accounts`);
  console.log(`${color('21.', MENU_COLORS.magenta)} Receive quest across all accounts`);
  console.log(`${color('22.', MENU_COLORS.magenta)} TX mesh across all accounts`);
}

function resolveMenuChoice(choice) {
  const map = {
    '0': 'exit',
    '1': 'run',
    '2': 'strategy',
    '3': 'status',
    '4': 'tx-grind',
    '5': 'burn',
    '6': 'stake',
    '7': 'child-wallets',
    '8': 'mint-scan',
    '9': 'setup',
    '10': 'mint-rank',
    '11': 'mint-all-ranks',
    '12': 'track',
    '13': 'campaign',
    '14': 'wallet-login-all',
    '15': 'status-all',
    '16': 'track-all',
    '17': 'mint-all-ranks-all',
    '18': 'campaign-all',
    '19': 'faucet-loop-all',
    '20': 'run-all',
    '21': 'receive-all',
    '22': 'tx-mesh-all',
  };
  return map[choice] || null;
}

function printMenuOrchestrationFooter() {
  printOrchestrationHelp();
}

function accountFilePath() {
  return currentAccountsFile();
}

function printAccountFilePath() {
  console.log(`accounts file: ${accountFilePath()}`);
}

function addAccountsDocsNote() {
  console.log(color('Tip: use `node bot.js setup --account name ...` to save multiple accounts.', MENU_COLORS.dim));
}

function maybePrintAccountsStartup() {
  ensureAccountFile();
  printAccountFilePath();
}

function accountStatusRow(name, result) {
  return `${name}: ${result.ok ? 'ok' : 'error'}`;
}

function printAccountStatusRows(orchestration) {
  orchestration.results.forEach((row) => console.log(accountStatusRow(row.account, row)));
}

function multiAccountSummary(orchestration) {
  return {
    total: orchestration.results.length,
    ok: orchestration.results.filter((r) => r.ok).length,
    failed: orchestration.results.filter((r) => !r.ok).length,
  };
}

function printMultiAccountSummary(orchestration) {
  console.log(JSON.stringify(multiAccountSummary(orchestration), null, 2));
}

function orchestratorNote() {
  return 'Orchestration runs accounts sequentially and continues on failure.';
}

function printOrchestratorNote() {
  console.log(orchestratorNote());
}

function printAllAccountsHint() {
  console.log('Use wallet-login-all / run-all / receive-all / tx-mesh-all / campaign-all / faucet-loop-all / track-all / status-all / mint-all-ranks-all for saved accounts.');
}

function orchestrationSnapshotPath(name) {
  return path.join(CONFIG_DIR, `${name}.json`);
}

function printOrchestrationSnapshotPath(name) {
  console.log(`snapshot: ${orchestrationSnapshotPath(name)}`);
}

function accountExists(name) {
  const accounts = loadAccounts();
  return Boolean(accounts[name]);
}

function printAccountExists(name) {
  console.log(`account '${name}' exists: ${accountExists(name)}`);
}

function accountNamesList() {
  return accountNames();
}

function printAccountNamesList() {
  console.log(JSON.stringify(accountNamesList(), null, 2));
}

function supportsAccountSelection() {
  return true;
}

function printSupportsAccountSelection() {
  console.log(`account selection: ${supportsAccountSelection()}`);
}

function printOrchestrationStartup() {
  printSupportsAccountSelection();
  printAccountOptionHelp();
  printAllAccountsHint();
}

function printAccountsMenuInfo() {
  printOrchestrationStartup();
  printOrchestrationMenuLines();
}

function isOrchestrationChoice(choice) {
  return ['14', '15', '16', '17', '18', '19', '20', '21'].includes(choice);
}

function printIsOrchestrationChoice(choice) {
  console.log(`orchestration choice: ${isOrchestrationChoice(choice)}`);
}

function printOrchestrationResult(orchestration) {
  printAccountSummary(orchestration);
  printAccountStatusRows(orchestration);
  printMultiAccountSummary(orchestration);
}

function accountCommandExamples() {
  return [
    'node bot.js wallet-login --account main',
    'node bot.js status --account main',
    'node bot.js track --account main',
    'node bot.js campaign --account main',
    'node bot.js wallet-login-all',
    'node bot.js status-all',
    'node bot.js run-all --strategy --profile balanced',
    'node bot.js receive-all --tx-count 1 --tx-amount 0.0001',
    'node bot.js tx-mesh-all --tx-count 1 --tx-amount 0.0001',
    'node bot.js campaign-all',
  ];
}

function printAccountCommandExamples() {
  accountCommandExamples().forEach((line) => console.log(`- ${line}`));
}

function printOrchestrationExamples() {
  console.log('Orchestration examples:');
  printAccountCommandExamples();
}

function printAccountsBlock() {
  printAccountBanner();
  maybePrintAccountsStartup();
  addAccountsDocsNote();
  printOrchestrationExamples();
}

function maybePrintAccountsBlock() {
  if (hasAccountsConfigured()) printAccountsBlock();
}

function commandUsesAccounts(command) {
  return command.includes('all') || ['campaign', 'track', 'status', 'receive', 'tx-mesh'].includes(command);
}

function printCommandUsesAccounts(command) {
  console.log(`uses accounts: ${commandUsesAccounts(command)}`);
}

function accountMetadata(bot) {
  return { account: bot.accountName || 'default', wallet: bot.wallet?.address || null };
}

function printAccountMetadata(bot) {
  console.log(JSON.stringify(accountMetadata(bot), null, 2));
}

function maybeAccountConfig(name) {
  const resolved = resolveDefaultAccountName(name);
  return resolved ? (loadAccounts()[resolved] || null) : null;
}

function printMaybeAccountConfig(name) {
  console.log(JSON.stringify(maybeAccountConfig(name), null, 2));
}

function accountCount() {
  return accountNames().length;
}

function printAccountCount() {
  console.log(`account count: ${accountCount()}`);
}

function orchestrationEnabled() {
  return accountCount() > 0;
}

function printOrchestrationEnabled() {
  console.log(`orchestration enabled: ${orchestrationEnabled()}`);
}

function statusAllSummary(orchestration) {
  return orchestration.results.map((row) => ({ account: row.account, ok: row.ok, result: row.result }));
}

function printStatusAllSummary(orchestration) {
  console.log(JSON.stringify(statusAllSummary(orchestration), null, 2));
}

function namedAccountPrompt() {
  return 'Account name (optional): ';
}

function printNamedAccountPrompt() {
  console.log(namedAccountPrompt());
}

function printAccountsMenuHint() {
  console.log(color('Saved accounts can be orchestrated together from the menu or CLI.', MENU_COLORS.dim));
}

function accountChooser(choice) {
  return resolveMenuChoice(choice);
}

function printAccountChooser(choice) {
  console.log(accountChooser(choice));
}

function ensureAccountsReady() {
  ensureAccountFile();
}

function printEnsureAccountsReady() {
  ensureAccountsReady();
  printAccountCount();
}

function accountSelectionSummary(name) {
  return name || 'default';
}

function printAccountSelectionSummary(name) {
  console.log(`selected account: ${accountSelectionSummary(name)}`);
}

function formatAccountLabel(name, cfg = {}) {
  const wallet = cfg.wallet || deriveWalletAddress(cfg.privateKey) || null;
  const parts = [name];
  if (wallet) parts.push(shortAddr(wallet));
  if (cfg.privateKey) parts.push('pk');
  if (cfg.cookies) parts.push('session');
  return parts.join(' | ');
}

async function promptForAccountSelection(currentName = null, allowDefault = true) {
  const config = loadAccountsConfig();
  const names = Object.keys(config.accounts);
  if (!names.length) return currentName || null;

  console.log('\nSaved accounts:');
  names.forEach((name, idx) => {
    const suffix = name === config.default ? ' (default)' : '';
    console.log(`  ${idx + 1}. ${formatAccountLabel(name, config.accounts[name])}${suffix}`);
  });
  if (allowDefault) console.log('  0. Keep current/default account');

  const answer = await prompt(`Choose account [${currentName || config.default || 'default'}]: `);
  if (!answer) return currentName || config.default || names[0];
  if (allowDefault && answer === '0') return currentName || config.default || names[0];
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= names.length) return names[index - 1];
  if (config.accounts[answer]) return answer;
  return currentName || config.default || names[0];
}

async function promptForAccountsSelection(currentName = null) {
  const config = loadAccountsConfig();
  const names = Object.keys(config.accounts);
  if (!names.length) return currentName ? [currentName] : [];

  const items = [
    { label: 'All accounts', value: '__all__', checked: false },
    ...names.map((name) => ({
      label: formatAccountLabel(name, config.accounts[name]) + (name === config.default ? ' (default)' : ''),
      value: name,
      checked: currentName ? name === currentName : name === config.default,
    })),
  ];

  const selected = await promptMultiToggle('Choose accounts', items);
  if (selected.includes('__all__')) return names;
  const chosen = selected.filter((value) => value !== '__all__' && config.accounts[value]);
  if (chosen.length) return chosen;
  return currentName ? [currentName] : [config.default || names[0]];
}

async function promptForCrateCount(maxOpens = 5) {
  const safeMax = Math.max(0, Number(maxOpens) || 0);
  if (safeMax <= 0) return 0;
  const answer = await prompt(`How many crates to open? [1-${safeMax}] (${safeMax}): `);
  if (!answer) return safeMax;
  const value = Number(answer);
  if (!Number.isInteger(value)) return safeMax;
  return Math.max(1, Math.min(value, safeMax));
}

async function runManualActionOnBots(bots, choice) {
  const outputs = [];
  for (const bot of bots) {
    console.log(`\n${color(`== ${bot.accountName || 'default'} ==`, MENU_COLORS.bold)}`);
    if (choice === '1') {
      outputs.push({ account: bot.accountName || 'default', result: await bot.sync() });
      console.log(JSON.stringify(outputs[outputs.length - 1].result, null, 2));
    } else if (choice === '2') {
      await bot.runExploration();
    } else if (choice === '3') {
      await bot.runSocialTasks();
    } else if (choice === '4') {
      await bot.runBadgeClaim();
    } else if (choice === '5') {
      await bot.runFaucet();
    } else if (choice === '6') {
      const history = await bot.crateHistory();
      const opensToday = history.opens_today || 0;
      const dailyLimit = history.daily_open_limit || 5;
      const remaining = Math.max(dailyLimit - opensToday, 0);
      if (remaining <= 0) {
        console.log('No crates available to open for this account today.');
      } else {
        const maxOpens = await promptForCrateCount(remaining);
        await bot.runCrates(maxOpens);
      }
    } else if (choice === '7') {
      const rows = await bot.getMintableRanks();
      outputs.push({ account: bot.accountName || 'default', result: rows });
      console.log(JSON.stringify(rows, null, 2));
    } else if (choice === '8') {
      const count = Number(await prompt(`Receive count [1]: `)) || 1;
      const amount = (await prompt(`Receive amount [${STRATEGY_DEFAULTS.txAmount}]: `)) || STRATEGY_DEFAULTS.txAmount;
      const result = await bot.receiveTransactions({ count, amount });
      outputs.push({ account: bot.accountName || 'default', result });
      console.log(JSON.stringify(result, null, 2));
    } else if (choice === '9') {
      const count = Number(await prompt(`Mesh count [1]: `)) || 1;
      const amount = (await prompt(`Mesh amount [${STRATEGY_DEFAULTS.txAmount}]: `)) || STRATEGY_DEFAULTS.txAmount;
      const result = await bot.txMesh({ count, amount });
      outputs.push({ account: bot.accountName || 'default', result });
      console.log(JSON.stringify(result, null, 2));
    } else if (choice === '10') {
      const durationHours = Number(await prompt('Duration hours [24]: ')) || 24;
      const intervalMinutes = Number(await prompt('Interval minutes [60]: ')) || 60;
      const result = await runFaucetLoop(bot, { durationHours, intervalMinutes });
      outputs.push({ account: bot.accountName || 'default', result });
      console.log(JSON.stringify(result, null, 2));
    } else {
      throw new Error('Invalid manual action');
    }
  }
  return outputs;
}

function createBotForAccount(name, args = {}) {
  return new DACBot({
    cookies: args.cookies,
    csrf: args.csrf,
    privateKey: args.privateKey,
    account: name,
    verbose: !args.quiet,
    humanMode: args.humanMode !== false,
    fastMode: !!args.fast,
    proxyRotation: args.proxyRotation || null,
    proxy: args.proxy || null,
  });
}

async function runManualActionMenu(bot, args = {}) {
  while (true) {
    const choice = await promptSingleSelect('Manual Actions', [
      { label: 'Sync only', value: '1' },
      { label: 'Exploration visit', value: '2' },
      { label: 'Social/API tasks', value: '3' },
      { label: 'Claim badges', value: '4' },
      { label: 'Faucet only', value: '5' },
      { label: 'Crates only', value: '6' },
      { label: 'Mint scan', value: '7' },
      { label: 'Receive quest', value: '8' },
      { label: 'Send + receive mesh', value: '9' },
      { label: 'Faucet loop (24h)', value: '10' },
      { label: 'Back to main menu', value: '11' },
    ], 0);
    if (choice === '11' || choice === null) return;
    try {
      const selectedAccounts = await promptForAccountsSelection(bot.accountName);
      const proxyRotation = args.proxyRotation || createConfiguredProxyRotation(loadAppConfig());
      const bots = selectedAccounts.map((name) => createBotForAccount(name, { ...args, proxyRotation }));
      await runManualActionOnBots(bots, choice);
    } catch (error) {
      console.log(`Error: ${formatErrorMessage(error)}`);
    }
    await prompt('\nPress Enter to continue...');
  }
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

function printAllAccountCommands() {
  printOrchestrationHelp();
  printAccountCommandExamples();
}

function multiAccountReady() {
  return hasAccountsConfigured();
}

function printMultiAccountReady() {
  console.log(`multi-account ready: ${multiAccountReady()}`);
}

function printAccountsFooter() {
  printAllAccountCommands();
}

function orchestrationResultFile(orchestration) {
  return orchestration.savedTo || null;
}

function printOrchestrationResultFile(orchestration) {
  if (orchestrationResultFile(orchestration)) console.log(`saved: ${orchestrationResultFile(orchestration)}`);
}

function noteAccounts() {
  console.log('Accounts are loaded from dac.config.json and can override the default session.');
}

function printNoteAccounts() {
  noteAccounts();
}

function accountCommandGroup() {
  return ['wallet-login-all', 'status-all', 'track-all', 'mint-all-ranks-all', 'campaign-all', 'faucet-loop-all', 'run-all', 'receive-all', 'tx-mesh-all'];
}

function printAccountCommandGroup() {
  console.log(JSON.stringify(accountCommandGroup(), null, 2));
}

function accountSupportSummary() {
  return { accountsFile: currentAccountsFile(), count: accountCount() };
}

function printAccountSupportSummary() {
  console.log(JSON.stringify(accountSupportSummary(), null, 2));
}

class DACBot {
  constructor({ cookies, csrf, privateKey, account, verbose = true, humanMode = true, fastMode = false, proxy = null, proxyRotation = null } = {}) {
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
      try {
        this.wallet = new ethers.Wallet(this.privateKey, this.provider);
      } catch (error) {
        this.walletInitError = error;
      }
    }
    this.walletAddress = this.wallet?.address || deriveWalletAddress(this.privateKey) || this.accountConfig.wallet || saved.wallet || null;
    const proxyAssignment = resolveAccountProxy(this.walletAddress || this.accountName, {
      accountConfig: this.accountConfig,
      proxy,
      proxyRotation: this.proxyRotation,
    });
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
    if (sessionCookies && sessionCsrf) {
      this.setSession(sessionCookies, sessionCsrf, false);
    }
    this.buildDefaultHeaders = buildDefaultHeaders;
    this.badgeTotalFromCatalog = badgeTotalFromCatalog;
    this.apiClient = createApiClient(this);
    this.endpoints = apiEndpoints.createEndpoints(this);
  }

  log(message) {
    if (this.verbose) console.log(message);
  }

  // ── HUMAN FEATURES ────────────────────────────────────────────────────────
  async humanDelay(baseMs, variancePct = null) {
    if (!this.humanMode) return;
    const pct = variancePct ?? this.humanFeatures.jitterVariancePct ?? 40;
    await sleep(jitter(baseMs, pct));
  }

  async humanPause(kind = 'default') {
    if (!this.humanMode) return;
    const ranges = {
      api: [150, 500],
      task: [200, 700],
      crate: [400, 1200],
      badge: [100, 350],
      tx: [400, 1200],
      scan: [50, 180],
      mint: [300, 1000],
      session: [250, 700],
      default: [150, 500],
    };
    const [min, max] = ranges[kind] || ranges.default;
    await sleep(jitterRange(min, max));
  }

  rotateUserAgent() {
    if (!this.humanMode || this.humanFeatures.rotateUserAgent === false) return;
    this.session.userAgent = pickUserAgent();
  }

  enforceSafety() {
    return false;
  }

  recordFailure(reason, { challenge = false } = {}) {
    const fc = (this.safety?.failureCount || 0) + 1;
    const cc = (this.safety?.challengeCount || 0) + (challenge ? 1 : 0);
    const cooldownSeconds = challenge ? Math.min(3600, 300 * cc) : Math.min(900, 60 * fc);
    this.safety = {
      failureCount: fc,
      challengeCount: cc,
      lastReason: reason,
      suspendedUntil: new Date(Date.now() + cooldownSeconds * 1000).toISOString(),
    };
    writeJson(SAFETY_FILE, this.safety);
    this.log(`⚠️  ${reason}; cooldown ${humanCooldown(cooldownSeconds)}`);
  }

  clearSafety() {
    this.safety = { suspendedUntil: null, lastReason: null, failureCount: 0, challengeCount: 0 };
    writeJson(SAFETY_FILE, this.safety);
  }

  classifyResponse(status, payload, bodyText = '') {
    const text = `${payload?.error || ''} ${payload?.body || ''} ${bodyText || ''}`.trim();
    return {
      challenge: isChallengeResponse(text),
      rateLimited: status === 429 || /too many requests|rate limit/i.test(text),
      blocked: status === 403 || status === 503 || isChallengeResponse(text),
    };
  }

  persistSession(cookieString, csrf) {
    const payload = {
      cookies: cookieString,
      csrf,
      privateKey: this.privateKey || undefined,
      wallet: this.walletAddress || undefined,
      updated: new Date().toISOString(),
    };
    if (this.accountName) {
      upsertAccount(this.accountName, payload, { makeDefault: true });
      return;
    }
    writeJson(currentSessionFile(), payload);
  }

  setSession(cookieString, csrf, persist = true) {
    const mergedCookies = mergeCookieStrings(this.session?.cookies, cookieString);
    this.session = {
      cookies: mergedCookies,
      csrf,
      cookieHeader: buildCookieHeader(mergedCookies),
      userAgent: this.session?.userAgent || pickUserAgent(),
    };
    this.invalidateRuntimeCache();
    if (persist) this.persistSession(mergedCookies, csrf);
  }

  invalidateRuntimeCache(keys = null) {
    const targets = keys && keys.length ? keys : Object.keys(this.runtimeCache || {});
    targets.forEach((key) => {
      if (!this.runtimeCache[key]) return;
      this.runtimeCache[key] = { value: null, expiresAt: 0, pending: null };
    });
  }

  getCachedValue(key) {
    const entry = this.runtimeCache?.[key];
    if (!entry || !entry.value) return null;
    if (entry.expiresAt <= Date.now()) return null;
    return entry.value;
  }

  async withCache(key, ttlMs, loader, { force = false } = {}) {
    if (!force) {
      const cached = this.getCachedValue(key);
      if (cached) return cached;
      const pending = this.runtimeCache?.[key]?.pending;
      if (pending) return pending;
    }
    const pending = (async () => {
      const value = await loader();
      if (!this.runtimeCache[key]) this.runtimeCache[key] = { value: null, expiresAt: 0, pending: null };
      this.runtimeCache[key].value = value;
      this.runtimeCache[key].expiresAt = Date.now() + ttlMs;
      this.runtimeCache[key].pending = null;
      return value;
    })();
    this.runtimeCache[key].pending = pending;
    try {
      return await pending;
    } catch (error) {
      this.runtimeCache[key].pending = null;
      throw error;
    }
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
    for (let i = 0; i < count; i += 1) {
      const wallet = ethers.Wallet.createRandom();
      wallets.push({
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic?.phrase || null,
      });
    }
    writeJson(CHILD_WALLETS_FILE, { createdAt: new Date().toISOString(), wallets });
    return { wallets, file: CHILD_WALLETS_FILE };
  }

  async sendNative(to, amountEth) {
    if (!this.wallet) throw new Error('No private key configured');
    const request = await buildLegacyTransferRequest(this.wallet, this.provider, {
      to,
      value: ethers.parseEther(String(amountEth)),
    });
    const tx = await this.wallet.sendTransaction(request);
    await waitForTxReceipt(this.provider, tx.hash);
    return { hash: tx.hash };
  }

  async grindTransactions({ count = 3, amount = '0.0001', recipients = [] } = {}) {
    if (!this.wallet) throw new Error('No private key configured');
    if (!recipients.length) {
      const generated = this.createChildWallets(Math.max(count, 3));
      recipients = generated.wallets.map((w) => w.address);
      this.log(`  🧪 Generated child wallets in ${generated.file}`);
    }

    const sent = [];
    for (let i = 0; i < Math.min(count, recipients.length); i += 1) {
      const to = recipients[i];
      const tx = await this.sendNative(to, amount);
      this.log(`  ✅ TX ${i + 1}: ${shortAddr(this.wallet.address)} -> ${shortAddr(to)} ${amount} DACC`);
      this.log(`     ${EXPLORER_URL}/tx/${tx.hash}`);
      sent.push({ to, amount, hash: tx.hash });
      await this.humanPause('tx');
    }
    const sync = await this.sync();
    await this.recordTaskCompletion('sync_tx', 'Sync transaction history');
    if (sent.length) await this.recordTaskCompletion('tx_first', 'Record first transaction');
    return { sent, sync };
  }

  loadChildWallets() {
    const data = readJson(CHILD_WALLETS_FILE, {});
    return Array.isArray(data.wallets) ? data.wallets : [];
  }

  async childWalletReceiveLoop({ count = 1, amount = '0.0001' } = {}) {
    if (!this.wallet) throw new Error('No private key configured');

    let children = this.loadChildWallets();
    if (children.length < count) {
      const generated = this.createChildWallets(Math.max(count, 3));
      children = generated.wallets;
      this.log(`  🧪 Generated child wallets in ${generated.file}`);
    }

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
      if (before < requiredWei) {
        const topUp = requiredWei - before;
        const fundRequest = await buildLegacyTransferRequest(this.wallet, this.provider, {
          to: child.address,
          value: topUp,
        });
        const fundTx = await this.wallet.sendTransaction(fundRequest);
        await waitForTxReceipt(this.provider, fundTx.hash);
        this.log(`  ➡️  Funded child ${shortAddr(child.address)} with ${fmtNum(ethers.formatEther(topUp))} DACC`);
      }

      const childBalance = await this.provider.getBalance(child.address);
      const sendable = childBalance > gasCost ? childBalance - gasCost : 0n;
      if (sendable < amountWei) {
        throw new Error(`Child wallet ${child.address} lacks enough balance to return funds after gas`);
      }

      const safeAmount = sendable < amountWei ? sendable : amountWei;
      if (safeAmount <= 0n) {
        throw new Error(`Child wallet ${child.address} has no safe return amount after gas`);
      }

      const returnAmount = safeAmount;

      const rxRequest = await buildLegacyTransferRequest(childSigner, this.provider, {
        to: this.wallet.address,
        value: returnAmount,
        gasLimit,
      });
      const rxTx = await childSigner.sendTransaction(rxRequest);
      await waitForTxReceipt(this.provider, rxTx.hash);
      this.log(`  ✅ RX loop: ${shortAddr(child.address)} -> ${shortAddr(this.wallet.address)} ${fmtNum(ethers.formatEther(returnAmount))} DACC`);
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
    const candidates = Object.entries(allAccounts)
      .filter(([name, cfg]) => name !== this.accountName && cfg && cfg.privateKey)
      .map(([name, cfg]) => ({ name, cfg, wallet: deriveWalletAddress(cfg.privateKey) }))
      .filter((row) => row.wallet && row.wallet.toLowerCase() !== this.wallet.address.toLowerCase());

    if (!candidates.length) {
      this.log('  ⚠️  No peer accounts with private keys found; falling back to child-wallet receive loop.');
      const fallback = await this.childWalletReceiveLoop({ count, amount });
      await this.recordTaskCompletion('tx_receive', 'Record received transaction');
      return fallback;
    }

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
      if (balance < requiredWei) {
        const topUp = requiredWei - balance;
        const fundTx = await this.wallet.sendTransaction({ to: peerWallet.address, value: topUp });
        await waitForTxReceipt(this.provider, fundTx.hash);
        this.log(`  ➡️  Seeded peer ${peer.name} (${shortAddr(peerWallet.address)}) with ${fmtNum(ethers.formatEther(topUp))} DACC`);
      }

      const peerRequest = await buildLegacyTransferRequest(peerWallet, this.provider, {
        to: this.wallet.address,
        value: amountWei,
        gasLimit,
      });
      const tx = await peerWallet.sendTransaction(peerRequest);
      await waitForTxReceipt(this.provider, tx.hash);
      this.log(`  ✅ RX mesh: ${peer.name} ${shortAddr(peerWallet.address)} -> ${shortAddr(this.wallet.address)} ${amount} DACC`);
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
    this.log(`  ⏳ Burn: submitting ${amountEth} DACC...`);
    const tx = await this.exchange.burnForQE({ value: ethers.parseEther(String(amountEth)) });
    this.log(`  📤 Burn submitted: ${tx.hash}`);
    this.log('  ⛏️  Burn: waiting for chain confirmation...');
    await waitForTxReceipt(this.provider, tx.hash);
    this.log('  🔄 Burn: confirming with backend...');
    const confirm = await this.confirmBurn(tx.hash);
    this.invalidateRuntimeCache(['profile', 'status']);
    await this.recordTaskCompletion('first_swap', 'Record burn for QE');
    this.log(`  ✅ Burn confirmed: ${tx.hash}`);
    return { hash: tx.hash, confirm };
  }

  async stakeDacc(amountEth) {
    if (!this.exchange) throw new Error('No private key configured');
    this.log(`  ⏳ Stake: submitting ${amountEth} DACC...`);
    const tx = await this.exchange.stake({ value: ethers.parseEther(String(amountEth)) });
    this.log(`  📤 Stake submitted: ${tx.hash}`);
    this.log('  ⛏️  Stake: waiting for chain confirmation...');
    await waitForTxReceipt(this.provider, tx.hash);
    this.log('  🔄 Stake: confirming with backend...');
    const confirm = await this.confirmStake(tx.hash);
    this.invalidateRuntimeCache(['profile', 'status']);
    await this.recordTaskCompletion('liquidity', 'Record DACC stake');
    this.log(`  ✅ Stake confirmed: ${tx.hash}`);
    return { hash: tx.hash, confirm };
  }

  async recordTaskCompletion(taskKey, label, extra = {}) {
    const result = await this.completeTask(taskKey, extra);
    if (result.success) this.log(`  ✅ ${label}: +${result.qe_awarded ?? '?'} QE`);
    else if (result._status === 400 || String(result.error || '').toLowerCase().includes('already')) this.log(`  ⏭️  ${label}: done`);
    else this.log(`  ❌ ${label}: ${result.error || 'unknown error'}`);
    await this.humanPause('task');
    return result;
  }

  async runSocialTasks() {
    const tasks = [
      ['x_follow', 'Follow X @dac_chain'],
      ['telegram', 'Join Telegram'],
      ['signin', 'Sign in with wallet'],
      ['sync', 'Sync account state'],
    ];
    for (const [taskKey, label] of tasks) {
      await this.recordTaskCompletion(taskKey, label);
    }
  }

  async runExploration() {
    const visits = [
      ['/faucet', 'Visit faucet', 'exp_faucet'],
      ['/leaderboard', 'Visit leaderboard', 'exp_leaderboard'],
      ['/badges', 'Visit badge gallery', 'exp_badges'],
    ];
    for (const [pathValue, label, taskKey] of visits) {
      const result = await this.visitPage(pathValue);
      if (result.success) this.log(`  ✅ ${label}`);
      else if (result._status === 400 || String(result.error || '').toLowerCase().includes('already')) this.log(`  ⏭️  ${label}: done`);
      else this.log(`  ❌ ${label}: ${result.error || 'unknown error'}`);
      if (taskKey) await this.recordTaskCompletion(taskKey, label);
    }
    const result = await this.visitExplorer();
    if (result.success && result.awarded) this.log('  ✅ Explorer visit: badge earned');
    else if (result.success) this.log('  ⏭️  Explorer: done');
    else this.log(`  ❌ Explorer: ${result.error || 'unknown error'}`);
    await this.recordTaskCompletion('exp_explorer', 'Visit explorer');
  }

  async runBadgeClaim() {
    const profile = await this.profile({ force: true });
    if (!Array.isArray(profile.badges)) {
      this.log('  ❌ Could not read earned badges');
      return { claimed: [], skippedEarned: [], skippedUnsupported: [], failed: [] };
    }
    const earned = new Set(profile.badges.map((b) => b.badge__key || b.badge_key || b.key).filter(Boolean));
    const catalog = (await this.badgeCatalog({ force: true })).badges || [];
    const supportedCategories = new Set(['exploration', 'onboarding', 'social', 'milestone', 'onchain']);
    const claimed = [];
    const skippedEarned = [];
    const skippedUnsupported = [];
    const failed = [];

    this.log(`  🔎 Badge detection: earned=${earned.size} catalog=${catalog.length}`);

    for (const badge of catalog) {
      const badgeKey = badge.key || badge.badge_key;
      if (!badgeKey) continue;
      if (earned.has(badgeKey)) {
        skippedEarned.push(badgeKey);
        continue;
      }
      if (!supportedCategories.has(badge.category)) {
        skippedUnsupported.push(badgeKey);
        continue;
      }
      const result = await this.claimBadge(badgeKey);
      if (result.success) {
        claimed.push({ key: badgeKey, name: badge.name, qe: result.qe_awarded ?? badge.qe_reward ?? 0 });
        this.invalidateRuntimeCache(['profile', 'status']);
        this.log(`  🏅 ${badge.name}: +${result.qe_awarded ?? badge.qe_reward ?? 0} QE`);
        await this.humanPause('badge');
      } else {
        failed.push({ key: badgeKey, name: badge.name, error: result.error || 'unknown error' });
        this.log(`  ❌ ${badge.name}: ${result.error || 'unknown error'}`);
      }
    }

    this.log(`  📘 Badge summary: claimed=${claimed.length} skipped-earned=${skippedEarned.length} skipped-unsupported=${skippedUnsupported.length} failed=${failed.length}`);
    if (claimed.length) this.log(`  ✅ Claimed: ${claimed.map((row) => row.name).join(', ')}`);
    if (failed.length) this.log(`  ⚠️  Failed: ${failed.map((row) => `${row.name} (${row.error})`).join('; ')}`);
    if (!claimed.length && !failed.length) this.log('  ⏭️  No claimable badges');

    return { claimed, skippedEarned, skippedUnsupported, failed };
  }

  async runFaucet() {
    const result = await this.claimFaucet();
    if (result.success) {
      this.invalidateRuntimeCache(['profile', 'status']);
      this.log(`  ✅ Faucet: +${result.amount ?? '?'} DACC`);
      return result;
    }
    if (result.code === 'social_required') this.log('  ⚠️  Faucet: needs X or Discord link');
    else if (String(result.error || '').toLowerCase().includes('available in')) this.log(`  ⏳ Faucet: ${result.error}`);
    else this.log(`  ❌ Faucet: ${result.error || 'unknown error'}`);
    return result;
  }

  async runCrates(maxOpens = 5) {
    const history = await this.crateHistory();
    const opensToday = history.opens_today || 0;
    const dailyLimit = history.daily_open_limit || 5;
    const remaining = Math.min(Math.max(dailyLimit - opensToday, 0), maxOpens);
    if (remaining <= 0) {
      this.log(`  ⏭️  Crates: ${opensToday}/${dailyLimit} used today`);
      return [];
    }

    const results = [];
    this.log(`  📦 Opening ${remaining} crates (${opensToday}/${dailyLimit} used)...`);
    for (let i = 0; i < remaining; i += 1) {
      const result = await this.openCrate();
      if (!result.success) {
        this.log(`    Crate ${i + 1}: ❌ ${result.error || 'unknown error'}`);
        break;
      }
      const reward = result.reward || {};
      this.invalidateRuntimeCache(['profile', 'status']);
      this.log(`    Crate ${i + 1}: ${reward.label || '?'} (+${reward.amount || 0} QE) → ${result.new_total_qe ?? '?'} total`);
      results.push(result);
      await this.humanPause('crate');
    }
    return results;
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
      if (this.nft && this.wallet) {
        try {
          minted = await this.nft.hasMinted(this.wallet.address, rank.id);
        } catch {
          minted = false;
        }
      }

      let backendReady = false;
      let backendError = null;
      let signature = null;
      let chainId = null;
      if (badgeOwned || eligibleByQe) {
        const probe = await this.claimSignature(rank.badgeKey);
        backendReady = Boolean(probe.success && probe.signature);
        backendError = backendReady ? null : (probe.error || null);
        signature = probe.signature ? String(probe.signature).replace(/^0x/i, '') : null;
        chainId = probe.chain_id || null;
      }

      rows.push({
        rankId: rank.id,
        rankName: rank.name,
        qeThreshold: rank.qe,
        badgeKey: rank.badgeKey,
        badgeOwned,
        eligibleByQe,
        minted,
        backendReady,
        backendError,
        signature,
        chainId,
        degraded,
        scanError: degraded ? 'status profile unavailable during mint scan' : null,
      });
      await this.humanPause('scan');
    }

    writeJson(MINT_CACHE_FILE, { updatedAt: new Date().toISOString(), rows });
    return rows;
  }

  async mintRank(rankKey) {
    if (!this.wallet || !this.nft) throw new Error('No private key configured');
    const rank = RANKS.find((r) => r.badgeKey === rankKey);
    if (!rank) throw new Error(`Unknown rank key: ${rankKey}`);

    const sig = await this.claimSignature(rankKey);
    if (!sig.success || !sig.signature) {
      throw new Error(sig.error || 'No mint signature returned');
    }
    const normalizedSignature = String(sig.signature).replace(/^0x/i, '');

    const alreadyMinted = await this.nft.hasMinted(this.wallet.address, sig.rank_id);
    if (alreadyMinted) {
      return { alreadyMinted: true, rankKey, rankId: sig.rank_id };
    }

    const tx = await this.nft.claimRank(sig.rank_id, `0x${normalizedSignature}`);
    await waitForTxReceipt(this.provider, tx.hash);
    const confirm = await this.confirmMint(tx.hash, rankKey);
    await this.recordTaskCompletion('nft_minter', 'Record NFT mint');
    return {
      rankKey,
      rankId: sig.rank_id,
      hash: tx.hash,
      confirm,
      explorer: `${EXPLORER_URL}/tx/${tx.hash}`,
    };
  }

  async mintRankWithRetry(rankKey, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await this.mintRank(rankKey);
        return { ok: true, attempt, ...result };
      } catch (error) {
        lastError = error;
        const message = error.message || String(error);

        // Re-probe on-chain/backend state before retrying.
        try {
          const scan = await this.getMintableRanks();
          const row = scan.find((item) => item.badgeKey === rankKey);
          if (row?.minted) {
            return { ok: true, attempt, rankKey, recovered: true, alreadyMinted: true, rankId: row.rankId };
          }
          if (row && !row.backendReady && /already minted/i.test(row.backendError || '')) {
            return { ok: true, attempt, rankKey, recovered: true, alreadyMinted: true, rankId: row.rankId };
          }
        } catch {}

        if (/Already minted/i.test(message)) {
          return { ok: true, attempt, rankKey, recovered: true, alreadyMinted: true };
        }

        if (attempt < attempts) {
          const delay = attempt * 1500;
          this.log(`  ⚠️  Mint ${rankKey} failed on attempt ${attempt}/${attempts}: ${message}`);
          this.log(`     Retrying after ${delay}ms...`);
          await sleep(delay);
          continue;
        }
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
      if (minted.ok) {
        this.log(`  ✅ Minted ${row.rankName}${minted.attempt ? ` (attempt ${minted.attempt})` : ''}`);
      } else {
        this.log(`  ❌ Mint ${row.rankName}: ${minted.error}`);
      }
      await this.humanPause('mint');
    }
    return { eligible: eligible.map((row) => row.badgeKey), results };
  }

  async leaderboard(limit = 10) {
    return this.api('GET', `/leaderboard/?limit=${limit}`);
  }

  async snapshotTracking() {
    const status = await this.status();
    const leaderboard = await this.leaderboard(25);
    const payload = {
      updatedAt: new Date().toISOString(),
      account: this.accountName || 'default',
      wallet: status.wallet,
      referralCode: status.profile?.referral_code || null,
      referralCount: status.profile?.referral_count || 0,
      userRank: status.rank,
      qe: status.qe,
      txCount: status.txCount,
      leaderboard: leaderboard.leaderboard || [],
    };
    const current = readJson(TRACKING_FILE, {});
    current[this.accountName || 'default'] = payload;
    writeJson(TRACKING_FILE, current);
    return payload;
  }

  async runCampaign(config = {}) {
    const campaign = {
      name: config.name || 'default-campaign',
      loops: config.loops || 1,
      intervalSeconds: config.intervalSeconds || 0,
      strategyProfile: config.strategyProfile || DEFAULT_PROFILE,
      actions: [],
    };

    for (let i = 0; i < campaign.loops; i += 1) {
      this.log(`\n=== Campaign loop ${i + 1}/${campaign.loops} ===`);
      const before = await this.status();
      const strategyPlan = await this.runStrategy({ profileName: campaign.strategyProfile });
      await this.run({
        strategy: false,
        profile: campaign.strategyProfile,
        tasks: true,
        badges: true,
        faucet: true,
        crates: true,
        mintScan: true,
      });
      const minted = await this.mintAllEligibleRanks();
      const tracking = await this.snapshotTracking();
      const after = await this.status();
      campaign.actions.push({
        loop: i + 1,
        before: { qe: before.qe, rank: before.rank, txCount: before.txCount },
        after: { qe: after.qe, rank: after.rank, txCount: after.txCount },
        strategyPlan,
        minted,
        tracking,
      });
      if (i < campaign.loops - 1 && campaign.intervalSeconds > 0) {
        this.log(`Sleeping ${campaign.intervalSeconds}s before next campaign loop...`);
        await sleep(campaign.intervalSeconds * 1000);
      }
    }

    writeJson(CAMPAIGN_FILE, campaign);
    return campaign;
  }

  buildStrategy(status, crateHistory, config) {
    const reserve = ethers.parseEther(String(config.reserveDacc));
    const balance = ethers.parseEther(String(status.dacc || '0'));
    const spendable = balance > reserve ? balance - reserve : 0n;
    const actions = [];
    const notes = [];

    notes.push(`profile=${config.profileName} balance=${fmtNum(status.dacc)} reserve=${config.reserveDacc} spendable=${fmtNum(ethers.formatEther(spendable))}`);
    notes.push('decision order: tx grind -> stake/burn surplus -> crates');

    const txBudget = ethers.parseEther(String(config.txAmount)) * BigInt(config.txCount);
    const lowTxCount = status.txCount < 3;
    if (this.wallet && spendable >= txBudget && lowTxCount) {
      actions.push({
        type: 'tx-grind',
        count: config.txCount,
        amount: config.txAmount,
        reason: 'low transaction count; use minimal surplus to push tx badges first',
      });
    }

    const remainingAfterTx = spendable > txBudget ? spendable - txBudget : spendable;
    const minStake = ethers.parseEther(String(config.minStakeAmount));
    const minBurn = ethers.parseEther(String(config.minBurnAmount));

    const stakeAmount = (remainingAfterTx * BigInt(Math.floor(config.stakeRatio * 10000))) / 10000n;
    const burnAmount = (remainingAfterTx * BigInt(Math.floor(config.burnRatio * 10000))) / 10000n;

    const maxSingleAction = ethers.parseEther('0.25');
    const cappedStake = stakeAmount > maxSingleAction ? maxSingleAction : stakeAmount;
    const cappedBurn = burnAmount > maxSingleAction ? maxSingleAction : burnAmount;

    if (this.wallet && cappedStake >= minStake) {
      actions.push({
        type: 'stake',
        amount: ethers.formatEther(cappedStake),
        reason: 'stake a capped share of surplus DACC for safer long-tail progression',
      });
    }

    if (this.wallet && cappedBurn >= minBurn) {
      actions.push({
        type: 'burn',
        amount: ethers.formatEther(cappedBurn),
        reason: 'burn a capped share of surplus DACC to convert into QE without over-spending',
      });
    }

    if (status.qe >= (crateHistory.cost_per_open || 150) && (crateHistory.opens_today || 0) < (crateHistory.daily_open_limit || 5)) {
      actions.push({
        type: 'crates',
        reason: 'QE is high enough and daily crate capacity remains',
      });
    }

    return { actions, notes, config };
  }

  async runStrategy(configOverrides = {}) {
    const requestedProfile = configOverrides.profileName || DEFAULT_PROFILE;
    const profileDefaults = STRATEGY_PROFILES[requestedProfile] || STRATEGY_DEFAULTS;
    const persisted = readJson(STRATEGY_FILE, {});
    const persistedProfile = persisted.profileName && !configOverrides.profileName ? persisted.profileName : requestedProfile;
    const effectiveProfileDefaults = STRATEGY_PROFILES[persistedProfile] || profileDefaults;
    const config = { ...effectiveProfileDefaults, ...persisted, ...configOverrides, profileName: persistedProfile };
    const status = await this.status();
    const crateHistory = await this.crateHistory();
    const plan = this.buildStrategy(status, crateHistory, config);

    console.log(`\n${color('╔════════════════════════════════════════════════════╗', MENU_COLORS.cyan)}`);
    console.log(color('║                SMART STRATEGY MODE                ║', MENU_COLORS.cyan));
    console.log(`╠════════════════════════════════════════════════════╣`);
    console.log(`║ Profile : ${String(config.profileName).padEnd(39)}║`);
    console.log(`║ DACC    : ${fmtNum(status.dacc).padEnd(39)}║`);
    console.log(`║ Reserve : ${String(config.reserveDacc).padEnd(39)}║`);
    console.log(`║ QE/TX   : ${`${status.qe} / ${status.txCount}`.padEnd(39)}║`);
    console.log(`╚════════════════════════════════════════════════════╝${MENU_COLORS.reset}`);
    console.log(color('\nPlan:', MENU_COLORS.bold));
    if (!plan.actions.length) console.log(color('- No actions selected', MENU_COLORS.dim));
    else plan.actions.forEach((action, idx) => console.log(`${color(`${idx + 1}.`, MENU_COLORS.magenta)} ${action.type}${action.amount ? ` (${fmtNum(action.amount)} DACC)` : ''} — ${action.reason}`));
    console.log(color('\nNotes:', MENU_COLORS.bold));
    plan.notes.forEach((note) => console.log(`${color('-', MENU_COLORS.yellow)} ${note}`));

    for (const action of plan.actions) {
      if (action.type === 'tx-grind') {
        await this.grindTransactions({ count: action.count, amount: action.amount });
      } else if (action.type === 'stake') {
        try {
          const result = await this.stakeDacc(action.amount);
          this.log(`  ✅ Stake tx: ${result.hash}`);
        } catch (error) {
          this.log(`  ⚠️  Stake skipped: ${formatErrorMessage(error)}`);
        }
      } else if (action.type === 'burn') {
        try {
          const result = await this.burnForQE(action.amount);
          this.log(`  ✅ Burn tx: ${result.hash}`);
        } catch (error) {
          this.log(`  ⚠️  Burn skipped: ${formatErrorMessage(error)}`);
        }
      } else if (action.type === 'crates') {
        await this.runCrates();
      }
    }

    writeJson(STRATEGY_FILE, config);
    return plan;
  }

  async run(options = {}) {
    const {
      crates = true,
      faucet = true,
      tasks = true,
      badges = true,
      txGrind = false,
      txCount = 3,
      txAmount = '0.0001',
      burnAmount = null,
      stakeAmount = null,
      strategy = false,
      profile = DEFAULT_PROFILE,
      mintScan = true,
      receive = false,
      receiveCount = 1,
      receiveAmount = txAmount,
      mesh = false,
      meshCount = 1,
      meshAmount = txAmount,
      progress = null,
    } = options;

    const plannedSteps = collectRunStepPlan({
      crates,
      faucet,
      tasks,
      badges,
      txGrind,
      txCount,
      burnAmount,
      stakeAmount,
      mintScan,
      receive,
      receiveCount,
      mesh,
      meshCount,
    });
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
      this.log('\n🧠 Strategy warmup...');
      strategyPlan = await this.runStrategy({
        profileName: profile,
        txCount,
        txAmount,
        ...(burnAmount ? { minBurnAmount: burnAmount } : {}),
        ...(stakeAmount ? { minStakeAmount: stakeAmount } : {}),
      });
      this.invalidateRuntimeCache(['profile', 'status']);
    }

    const before = await this.status();
    if (before.error) throw new Error(before.error);
    const network = await this.network();
    if (network.error) throw new Error(network.error);

    this.log(`\n============================================================`);
    this.log(`  DAC INCEPTION BOT — ${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`);
    this.log(`============================================================`);
    this.log(`\n📊 QE=${before.qe ?? '?'} | DACC=${before.dacc ?? '?'} | #${before.rank ?? '?'} | ${before.badges ?? 0}/${resolveBadgeTotal(before.badgeTotal, 1)} badges | ${before.streak ?? 0}d streak | ${before.multiplier ?? 1}x`);
    this.log(`   Wallet: ${before.wallet || '-'} | tx_count=${before.txCount ?? 0}`);
    this.log(`   Network: blk=${network.block_number ?? '?'} tps=${network.tps ?? '?'} bt=${network.block_time ?? '?'}`);
    if (!before.faucetAvailable) this.log(`   Faucet cooldown: ${humanCooldown(before.faucetCooldownSeconds || 0)}`);
    if (this.wallet) this.log(`   Signer: ${this.wallet.address}`);

    advanceStep('sync', 'Sync account state');
    this.log('\n🔄 Syncing...');
    const sync = await this.sync();
    this.invalidateRuntimeCache(['profile', 'status']);
    if (sync.success) this.log(`  ✅ DACC=${sync.dacc_balance}, txns=${sync.tx_count}`);
    else this.log(`  ❌ Sync: ${sync.error || 'unknown error'}`);

    advanceStep('explore', 'Run exploration checks');
    this.log('\n🗺️  Exploration...');
    await this.runExploration();

    if (tasks) {
      advanceStep('tasks', 'Complete social tasks');
      this.log('\n🎯 Tasks...');
      await this.runSocialTasks();
    }

    if (badges) {
      advanceStep('badges', 'Claim badges');
      this.log('\n🏅 Badges...');
      await this.runBadgeClaim();
    }

    if (faucet) {
      advanceStep('faucet', 'Claim faucet');
      this.log('\n🚰 Faucet...');
      await this.runFaucet();
    }

    if (txGrind) {
      advanceStep('txGrind', `Send TX x${txCount}`);
      this.log('\n🧪 TX Grind...');
      try { await this.grindTransactions({ count: txCount, amount: txAmount }); }
      catch (error) { this.log(`  ❌ TX Grind: ${formatErrorMessage(error)}`); }
    }

    if (receive) {
      advanceStep('receive', `Receive quest x${receiveCount}`);
      this.log('\n📥 Receive quest...');
      try { await this.receiveTransactions({ count: receiveCount, amount: receiveAmount }); }
      catch (error) { this.log(`  ❌ Receive: ${formatErrorMessage(error)}`); }
    }

    if (mesh) {
      advanceStep('mesh', `Mesh loop x${meshCount}`);
      this.log('\n🔁 Send + receive mesh...');
      try { await this.txMesh({ count: meshCount, amount: meshAmount }); }
      catch (error) { this.log(`  ❌ Mesh: ${formatErrorMessage(error)}`); }
    }

    if (burnAmount) {
      advanceStep('burn', `Burn ${burnAmount} DACC`);
      this.log('\n🔥 Burn for QE...');
      try {
        const result = await this.burnForQE(burnAmount);
        this.log(`  ✅ Burn tx: ${result.hash}`);
      } catch (error) {
        this.log(`  ❌ Burn: ${formatErrorMessage(error)}`);
      }
    }

    if (stakeAmount) {
      advanceStep('stake', `Stake ${stakeAmount} DACC`);
      this.log('\n🏦 Stake DACC...');
      try {
        const result = await this.stakeDacc(stakeAmount);
        this.log(`  ✅ Stake tx: ${result.hash}`);
      } catch (error) {
        this.log(`  ❌ Stake: ${formatErrorMessage(error)}`);
      }
    }

    if (mintScan) {
      advanceStep('mintScan', 'Scan and auto-mint eligible ranks');
      this.log('\n🛡️  Mint Scan...');
      const mintRows = await this.getMintableRanks();
      const mintable = mintRows.filter((r) => r.backendReady && !r.minted);
      this.log(`  ${mintable.length ? `Potentially mintable ranks: ${mintable.map((r) => r.rankName).join(', ')}` : 'No backend-ready rank mints detected yet'}`);
      if (mintable.length) {
        this.log('\n✨ Auto-minting backend-ready ranks...');
        const minted = await this.mintAllEligibleRanks();
        const okCount = (minted.results || []).filter((row) => row.ok).length;
        const failCount = (minted.results || []).filter((row) => !row.ok).length;
        this.log(`  ✅ Auto-mint complete: ${okCount} success, ${failCount} failed`);
        this.invalidateRuntimeCache(['profile', 'status']);
      }
    }

    if (crates) {
      advanceStep('crates', 'Open crates');
      this.log('\n📦 Crates...');
      await this.runCrates();
    }

    const after = await this.status();
    this.log(`\n────────────────────────────────────────────────────────────`);
    this.log(`📊 FINAL: QE=${after.qe} | DACC=${after.dacc} | #${after.rank} | ${after.badges} badges | tx_count=${after.txCount}`);
    this.log(`============================================================\n`);
    return { ok: true, strategyPlan };
  }
}

async function runGuidedLauncher(bot, args = {}) {
  while (true) {
    const warmSnapshot = args.fast ? null : bot.fetchDashboardSnapshot().catch(() => null);

    console.clear();
    printLauncherHeader(bot.getCachedValue('status'), bot.getCachedValue('network'), bot);
    printBox('SYSTEM CHECK', [
      `${renderMetric('Status', 'warming account snapshot', 12, MENU_COLORS.yellow)}`,
      `${renderMetric('Network', 'warming chain data', 12, MENU_COLORS.dim)}`,
    ], { width: 88, tone: MENU_COLORS.blue });
    console.log('');

    const mode = await promptSingleSelect('Launcher Modes', [
      { label: 'Auto - guided automation on current account', value: 'auto' },
      { label: 'Auto All - one click automation for all accounts', value: 'auto-all' },
      { label: 'Manual - one task group at a time', value: 'manual' },
      { label: 'Summary - all-accounts dashboard', value: 'summary' },
      { label: 'Faucet Loop - single account 24h mode', value: 'faucet-loop' },
      { label: 'Faucet Loop All - multi-account 24h mode', value: 'faucet-loop-all' },
      { label: 'Account - switch active account', value: 'account' },
      { label: 'Advanced - mint / burn / stake / tracking', value: 'advanced' },
      { label: 'Exit', value: 'exit' },
    ], 0);
    if (mode === 'exit' || mode === null) break;

    let status = bot.getCachedValue('status');
    let network = bot.getCachedValue('network');
    if (!status || !network) {
      if (warmSnapshot) {
        const warmed = await warmSnapshot;
        status = warmed?.status || bot.getCachedValue('status');
        network = warmed?.network || bot.getCachedValue('network');
      }
    }

    console.clear();
    printLauncherHeader(status, network, bot);
    printBox('OPERATOR OVERVIEW', renderLauncherOverview(status, network, bot, mode), { width: 88, tone: MENU_COLORS.blue });
    console.log('');

    try {
      if (mode === 'account') {
        const selected = await promptForAccountSelection(bot.accountName, true);
        if (selected && selected !== bot.accountName) bot = createBotForAccount(selected, args);
      } else if (mode === 'summary') {
        const result = await orchestrateStatusAll({
          verbose: !args.quiet,
          humanMode: args.humanMode !== false,
          fastMode: !!args.fast,
          onAccountStart: ({ account, index, total }) => {
            console.clear();
            printLauncherHeader(status, network, bot);
            printSummaryLoadingBanner({ account, index, total });
          },
          onAccountComplete: ({ account, index, total, ok, error }) => {
            console.log(ok
              ? color(`✓ Loaded ${account} (${index + 1}/${total})`, MENU_COLORS.green)
              : color(`✗ Failed ${account} (${index + 1}/${total}) - ${error}`, MENU_COLORS.red));
          },
        });
        console.clear();
        printLauncherHeader(status, network, bot);
        printAccountsDashboard(result);
        await prompt('\nPress Enter to continue...');
      } else if (mode === 'manual') {
        await runManualActionMenu(bot, args);
      } else if (mode === 'faucet-loop') {
        const durationHours = Number(await prompt('Duration hours [24]: ')) || 24;
        const intervalMinutes = Number(await prompt('Interval minutes [60]: ')) || 60;
        console.log(JSON.stringify(await runFaucetLoop(bot, { durationHours, intervalMinutes }), null, 2));
        await prompt('\nPress Enter to continue...');
      } else if (mode === 'faucet-loop-all') {
        const durationHours = Number(await prompt('Duration hours [24]: ')) || 24;
        const intervalMinutes = Number(await prompt('Interval minutes [60]: ')) || 60;
        const result = await orchestrateFaucetLoopAll({ durationHours, intervalMinutes, verbose: !args.quiet, humanMode: args.humanMode !== false, fastMode: !!args.fast });
        printAccountSummary(result);
        await prompt('\nPress Enter to continue...');
      } else if (mode === 'auto' || mode === 'auto-all') {
        const selected = await promptMultiToggle('Toggle automation groups', [
          { label: 'Social/API tasks', value: 'tasks', checked: true },
          { label: 'Badge claiming', value: 'badges', checked: true },
          { label: 'Faucet', value: 'faucet', checked: false },
          { label: 'Crates', value: 'crates', checked: false },
          { label: 'Mint scan', value: 'mintScan', checked: true },
          { label: 'Send TX', value: 'txGrind', checked: false },
          { label: 'Receive quest', value: 'receive', checked: false },
          { label: 'Smart strategy mode', value: 'strategy', checked: false },
          { label: 'Stake DACC', value: 'stake', checked: false },
          { label: 'Burn DACC for QE', value: 'burn', checked: false },
        ]);
        const enabled = new Set(selected);
        let profile = DEFAULT_PROFILE;
        if (enabled.has('strategy')) {
          profile = await promptSingleSelect('Choose strategy profile', [
            { label: 'Safe', value: 'safe' },
            { label: 'Balanced', value: 'balanced' },
            { label: 'Aggressive', value: 'aggressive' },
          ], 1) || DEFAULT_PROFILE;
        }
        let txCount = STRATEGY_DEFAULTS.txCount;
        let txAmount = STRATEGY_DEFAULTS.txAmount;
        if (enabled.has('txGrind')) {
          txCount = Number(await prompt(`TX grind count [${STRATEGY_DEFAULTS.txCount}]: `)) || STRATEGY_DEFAULTS.txCount;
          txAmount = (await prompt(`TX grind amount [${STRATEGY_DEFAULTS.txAmount}]: `)) || STRATEGY_DEFAULTS.txAmount;
        }
        let receiveCount = 1;
        let receiveAmount = STRATEGY_DEFAULTS.txAmount;
        if (enabled.has('receive')) {
          receiveCount = Number(await prompt('Receive count [1]: ')) || 1;
          receiveAmount = (await prompt(`Receive amount [${STRATEGY_DEFAULTS.txAmount}]: `)) || STRATEGY_DEFAULTS.txAmount;
        }
        let stakeAmount = null;
        if (enabled.has('stake')) {
          stakeAmount = (await prompt('Stake amount [0.01]: ')) || '0.01';
        }
        let burnAmount = null;
        if (enabled.has('burn')) {
          burnAmount = (await prompt('Burn amount [0.01]: ')) || '0.01';
        }
        const runOptions = {
          tasks: enabled.has('tasks'),
          badges: enabled.has('badges'),
          faucet: enabled.has('faucet'),
          crates: enabled.has('crates'),
          strategy: enabled.has('strategy'),
          profile,
          mintScan: enabled.has('mintScan'),
          txGrind: enabled.has('txGrind'),
          txCount,
          txAmount,
          receive: enabled.has('receive'),
          receiveCount,
          receiveAmount,
          stakeAmount,
          burnAmount,
        };
        const reviewTarget = mode === 'auto-all' ? `${accountNames().length} accounts` : (bot.accountName || 'default account');
        printAutomationReview(mode, reviewTarget, runOptions);
        await prompt('\nPress Enter to start automation...');
        if (mode === 'auto-all') {
          const result = await orchestrateRunAll({
            ...runOptions,
            verbose: !args.quiet,
            humanMode: args.humanMode !== false,
            fastMode: !!args.fast,
            onAccountStart: ({ account, index, total }) => {
              printAutoAllAccountBanner({ account, index, total });
            },
            onAccountComplete: ({ account, index, total, ok, error }) => {
              if (ok) console.log(color(`✅ Completed ${account} (${index + 1}/${total})`, MENU_COLORS.green));
              else console.log(color(`❌ Failed ${account} (${index + 1}/${total}) - ${error}`, MENU_COLORS.red));
            },
            progress: ({ account, step, total, label, detail }) => renderAutomationStepPanel({ account, step, total, label, detail }),
          });
          printAccountSummary(result);
        } else {
          await bot.run({
            ...runOptions,
            progress: ({ step, total, label, detail }) => renderAutomationStepPanel({ step, total, label, detail }),
          });
        }
        await prompt('\nPress Enter to continue...');
      } else if (mode === 'advanced') {
        const tool = await promptSingleSelect('Advanced Tools', [
          { label: 'Transaction grind', value: 'tx' },
          { label: 'Receive quest', value: 'receive' },
          { label: 'Burn DACC for QE', value: 'burn' },
          { label: 'Stake DACC', value: 'stake' },
          { label: 'Mint scan / mint rank', value: 'mint' },
          { label: 'Tracking snapshot', value: 'track' },
          { label: 'Campaign cycle', value: 'camp' },
          { label: 'Faucet loop (24h)', value: 'faucetloop' },
          { label: 'Save/update current account secrets', value: 'save' },
          { label: 'Back', value: 'back' },
        ], 0);
        if (tool === 'tx') {
          const count = Number(await prompt(`TX count [${STRATEGY_DEFAULTS.txCount}]: `)) || STRATEGY_DEFAULTS.txCount;
          const amount = (await prompt(`TX amount [${STRATEGY_DEFAULTS.txAmount}]: `)) || STRATEGY_DEFAULTS.txAmount;
          await bot.grindTransactions({ count, amount });
        } else if (tool === 'receive') {
          const count = Number(await prompt('Receive count [1]: ')) || 1;
          const amount = (await prompt(`Receive amount [${STRATEGY_DEFAULTS.txAmount}]: `)) || STRATEGY_DEFAULTS.txAmount;
          console.log(JSON.stringify(await bot.receiveTransactions({ count, amount }), null, 2));
        } else if (tool === 'burn') {
          const amount = (await prompt('Burn amount [0.01]: ')) || '0.01';
          console.log(JSON.stringify(await bot.burnForQE(amount), null, 2));
        } else if (tool === 'stake') {
          const amount = (await prompt('Stake amount [0.01]: ')) || '0.01';
          console.log(JSON.stringify(await bot.stakeDacc(amount), null, 2));
        } else if (tool === 'mint') {
          const rows = await bot.getMintableRanks();
          console.log('\nRank | Name         | State     | Badge | QE');
          console.log('-----+--------------+-----------+-------+-------');
          for (const row of rows) {
            const state = row.minted ? 'minted' : row.backendReady ? 'eligible' : row.eligibleByQe ? 'qe-ready' : 'locked';
            console.log(`${String(row.rankId).padStart(4)} | ${row.rankName.padEnd(12)} | ${state.padEnd(9)} | ${String(row.badgeOwned).padEnd(5)} | ${row.qeThreshold}`);
          }
          if (await promptYesNo('Mint a rank NFT now?', false)) {
            const rankKey = (await prompt('Rank key to mint (e.g. rank_cadet): ')).trim();
            console.log(JSON.stringify(await bot.mintRank(rankKey), null, 2));
          }
        } else if (tool === 'track') {
          console.log(JSON.stringify(await bot.snapshotTracking(), null, 2));
        } else if (tool === 'camp') {
          const profile = await promptSingleSelect('Choose strategy profile', [
            { label: 'Safe', value: 'safe' },
            { label: 'Balanced', value: 'balanced' },
            { label: 'Aggressive', value: 'aggressive' },
          ], 1) || DEFAULT_PROFILE;
          console.log(JSON.stringify(await bot.runCampaign({ loops: 1, strategyProfile: profile, intervalSeconds: 0 }), null, 2));
        } else if (tool === 'faucetloop') {
          const durationHours = Number(await prompt('Duration hours [24]: ')) || 24;
          const intervalMinutes = Number(await prompt('Interval minutes [60]: ')) || 60;
          console.log(JSON.stringify(await runFaucetLoop(bot, { durationHours, intervalMinutes }), null, 2));
        } else if (tool === 'save') {
          const selectedName = bot.accountName || (resolveDefaultAccountName() || 'main');
          const current = loadAccountsConfig();
          const existing = current.accounts[selectedName] || {};
          const cookies = await prompt('Cookies [keep current]: ');
          const csrf = await prompt('CSRF [keep current]: ');
          const privateKey = await prompt('Private key [keep current]: ');
          const wallet = deriveWalletAddress(privateKey || existing.privateKey || null) || existing.wallet || null;
          upsertAccount(selectedName, {
            cookies: cookies || existing.cookies,
            csrf: csrf || existing.csrf,
            privateKey: privateKey || existing.privateKey,
            wallet,
            updated: new Date().toISOString(),
          }, { makeDefault: true });
          console.log(`Saved account '${selectedName}' to ${currentAccountsFile()}`);
        }
        if (tool && tool !== 'back') await prompt('\nPress Enter to continue...');
      }
    } catch (error) {
      console.log(`Error: ${formatErrorMessage(error)}`);
      await prompt('\nPress Enter to continue...');
    }
  }
}

async function runMenu(bot, args = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('Interactive menu needs a TTY. Use direct commands instead.');
    return;
  }
  return runGuidedLauncher(bot, args);
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.command === 'help') {
    maybePrintCommandBrand(args.command, { quiet: args.quiet });
    printHelp();
    return;
  }

  maybePrintCommandBrand(args.command, { quiet: args.quiet });

  ensureAccountsReady();
  if (await maybeHandleOrchestration(args.command, args)) {
    return;
  }

  if (args.command === 'setup') {
    if ((!args.cookies || !args.csrf) && !args.privateKey) {
      printHelp();
      process.exitCode = 1;
      return;
    }

    const resolvedAccount = args.account || resolveDefaultAccountName() || 'main';
    const resolvedPrivateKey = args.privateKey || maybeAccountConfig(resolvedAccount)?.privateKey || null;
    const wallet = deriveWalletAddress(resolvedPrivateKey);
    let payload = {
      cookies: args.cookies || undefined,
      csrf: args.csrf || undefined,
      privateKey: resolvedPrivateKey || undefined,
      wallet: wallet || undefined,
      updated: new Date().toISOString(),
    };

    if ((!payload.cookies || !payload.csrf) && resolvedPrivateKey) {
      const bootstrapBot = new DACBot({
        privateKey: resolvedPrivateKey,
        account: resolvedAccount,
        verbose: !args.quiet,
        humanMode: args.humanMode !== false,
        fastMode: !!args.fast,
      });
      const auth = await bootstrapBot.walletLogin(true);
      payload = {
        cookies: bootstrapBot.session.cookies,
        csrf: bootstrapBot.session.csrf,
        privateKey: resolvedPrivateKey,
        wallet: bootstrapBot.walletAddress,
        updated: new Date().toISOString(),
      };
      if (!args.quiet) {
        console.log(`✅ Wallet-auth bootstrap complete for ${bootstrapBot.walletAddress}`);
        if (auth?.user?.id) console.log(`   user_id=${auth.user.id}`);
      }
    }

    const config = upsertAccount(resolvedAccount, payload, { makeDefault: true });
    console.log(`✅ Credentials saved for account '${resolvedAccount}' in ${currentAccountsFile()}`);
    if (!args.quiet && config.default === resolvedAccount) console.log(`✅ Default account set to '${resolvedAccount}'`);
    return;
  }

  const bot = new DACBot({
    cookies: args.cookies,
    csrf: args.csrf,
    privateKey: args.privateKey,
    account: args.account,
    verbose: !args.quiet,
    humanMode: args.humanMode !== false,
    fastMode: !!args.fast,
  });

  if (args.command === 'wallet-login') {
    const result = await bot.walletLogin(true);
    if (!args.quiet) console.log(JSON.stringify({ ok: true, wallet: bot.walletAddress, auth: result }, null, 2));
    return;
  }

  if (args.command === 'clear-safety') {
    bot.clearSafety();
    console.log('✅ Safety state cleared.');
    return;
  }

  if (args.command === 'human-status') {
    const safety = readJson(SAFETY_FILE, {});
    console.log(JSON.stringify({
      humanMode: bot.humanMode,
      safety,
    }, null, 2));
    return;
  }

  if (args.command === 'status') {
    const status = await bot.status();
    const network = await bot.network();
    console.log(JSON.stringify({ ...status, network, signer: bot.wallet?.address || null }, null, 2));
    return;
  }

  if (args.command === 'child-wallets') {
    const result = bot.createChildWallets(args.txCount || 3);
    console.log(`✅ Created ${result.wallets.length} child wallets in ${result.file}`);
    return;
  }

  if (args.command === 'tx-grind') {
    await bot.grindTransactions({ count: args.txCount, amount: args.txAmount });
    return;
  }

  if (args.command === 'receive') {
    console.log(JSON.stringify(await bot.receiveTransactions({ count: args.txCount, amount: args.txAmount }), null, 2));
    return;
  }

  if (args.command === 'tx-mesh') {
    console.log(JSON.stringify(await bot.txMesh({ count: args.txCount, amount: args.txAmount }), null, 2));
    return;
  }

  if (args.command === 'burn') {
    if (!args.burnAmount) throw new Error('Use --burn <amount>');
    console.log(JSON.stringify(await bot.burnForQE(args.burnAmount), null, 2));
    return;
  }

  if (args.command === 'stake') {
    if (!args.stakeAmount) throw new Error('Use --stake <amount>');
    console.log(JSON.stringify(await bot.stakeDacc(args.stakeAmount), null, 2));
    return;
  }

  if (args.command === 'mint-scan') {
    const rows = await bot.getMintableRanks();
    console.log(JSON.stringify({ updatedAt: new Date().toISOString(), rows }, null, 2));
    return;
  }

  if (args.command === 'mint-rank') {
    if (!args.rankKey) throw new Error('Use --rank-key <rank_key>');
    const result = await bot.mintRank(args.rankKey);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'mint-all-ranks') {
    const result = await bot.mintAllEligibleRanks();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'track') {
    const result = await bot.snapshotTracking();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'faucet-loop') {
    const result = await runFaucetLoop(bot, { durationHours: args.durationHours || 24, intervalMinutes: args.interval || 60 });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'campaign') {
    const result = await bot.runCampaign({ loops: 1, strategyProfile: args.profile || DEFAULT_PROFILE, intervalSeconds: 0 });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'strategy') {
    await bot.run({ strategy: true, profile: args.profile, txCount: args.txCount, txAmount: args.txAmount });
    return;
  }

  if (args.command === 'menu' || args.command === 'interactive') {
    await runMenu(bot, args);
    return;
  }

  if (args.command === 'manual' && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.log('Manual mode needs a TTY. Use direct commands instead.');
    return;
  }

  if (args.command === 'manual') {
    await runManualActionMenu(bot, args);
    return;
  }

  if (args.command === 'loop') {
    while (true) {
      try {
        await bot.run({
          crates: !args.noCrates,
          faucet: !args.noFaucet,
          tasks: !args.noTasks,
          badges: !args.noBadges,
          txGrind: args.txGrind,
          txCount: args.txCount,
          txAmount: args.txAmount,
          burnAmount: args.burnAmount,
          stakeAmount: args.stakeAmount,
          strategy: args.strategy,
        });
        console.log(`💤 Sleeping ${args.interval}m...`);
        await sleep(args.interval * 60 * 1000);
      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        await sleep(60 * 1000);
      }
    }
  }

  await bot.run({
    crates: !args.noCrates,
    faucet: !args.noFaucet,
    tasks: !args.noTasks,
    badges: !args.noBadges,
    txGrind: args.txGrind,
    txCount: args.txCount,
    txAmount: args.txAmount,
    burnAmount: args.burnAmount,
    stakeAmount: args.stakeAmount,
    strategy: args.strategy,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  DACBot,
  main,
  parseArgs,
  orchestrateRunAll,
  orchestrateStatusAll,
  orchestrateCampaignAll,
  orchestrateTrackAll,
  orchestrateMintAllRanks,
  orchestrateReceiveAll,
  orchestrateTxMeshAll,
  runMenu,
  runGuidedLauncher,
  runManualActionMenu,
  runAcrossAccounts,
  runFaucetLoop,
  orchestrateFaucetLoopAll,
  waitForTxReceipt,
  buildLegacyTransferRequest,
};
