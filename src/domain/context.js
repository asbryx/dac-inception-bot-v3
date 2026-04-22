const { DACBot } = require('../legacy/runtime');
const statusDomain = require('./status');
const { resolveAccountProxy } = require('../addons/proxies');

function createLegacyBackedBot(accountName, overrides = {}) {
  return new DACBot({
    account: accountName,
    verbose: overrides.verbose ?? false,
    humanMode: overrides.humanMode ?? true,
    fastMode: overrides.fastMode ?? false,
    cookies: overrides.cookies ?? null,
    csrf: overrides.csrf ?? null,
    privateKey: overrides.privateKey ?? null,
    proxy: overrides.proxy ?? null,
    proxyRotation: overrides.proxyRotation ?? null,
  });
}

function describeProxy(proxy) {
  return proxy ? { url: proxy.url, label: proxy.label } : null;
}

function resolveProxyKey(accountName, overrides = {}) {
  const walletAddress = overrides.walletAddress
    || overrides.accountConfig?.wallet
    || (overrides.privateKey ? require('../chain/wallet').deriveWalletAddress(overrides.privateKey) : null);
  return walletAddress || accountName;
}

function resolveProxyAssignment(accountName, overrides = {}) {
  const proxyKey = resolveProxyKey(accountName, overrides);
  const resolved = resolveAccountProxy(proxyKey, {
    accountConfig: overrides.accountConfig || null,
    proxy: overrides.proxy ?? null,
    proxyRotation: overrides.proxyRotation ?? null,
  });
  return {
    proxy: resolved.proxy,
    proxySource: resolved.source,
    proxyKey,
  };
}

function createStatusService(bot) {
  return {
    async fetchNormalizedStatus({ force = false } = {}) {
      const profileData = await bot.profile({ force });
      const networkData = await bot.network({ force });
      const catalogData = await bot.badgeCatalog({ force });
      return statusDomain.normalizeStatus({
        accountName: bot.accountName,
        wallet: bot.walletAddress,
        profileData,
        networkData,
        catalogData,
      });
    },
  };
}

function createAutomationService(bot) {
  return {
    async run(options = {}, onProgress = null) {
      const emit = (step, detail = {}) => {
        if (typeof onProgress === 'function') onProgress({ step, ...detail });
      };
      emit('bootstrap', { message: 'starting automation run' });
      const result = await bot.run(options);
      emit('complete', { message: 'automation run complete' });
      return result;
    },
  };
}

async function createAccountContext(accountName, overrides = {}) {
  const accountConfig = overrides.accountConfig || null;
  const proxyAssignment = resolveProxyAssignment(accountName, {
    ...overrides,
    accountConfig,
  });
  const bot = createLegacyBackedBot(accountName, {
    ...overrides,
    accountConfig,
    proxy: proxyAssignment.proxy,
  });
  bot.proxySource = proxyAssignment.proxySource;
  bot.proxyKey = proxyAssignment.proxyKey;
  return {
    accountName: bot.accountName,
    accountConfig: bot.accountConfig,
    session: bot.session,
    wallet: bot.wallet,
    provider: bot.provider,
    proxy: describeProxy(bot.proxy),
    proxySource: bot.proxySource,
    bot,
    services: {
      statusService: createStatusService(bot),
      automation: createAutomationService(bot),
    },
  };
}

async function createSingleAccountContext(args = {}) {
  return createAccountContext(args.account || null, {
    verbose: !args.quiet,
    fastMode: !!args.fast,
    humanMode: args.humanMode !== false,
    cookies: args.cookies ?? null,
    csrf: args.csrf ?? null,
    privateKey: args.privateKey ?? null,
    proxy: args.proxy ?? null,
    proxyRotation: args.proxyRotation ?? null,
    accountConfig: args.accountConfig ?? null,
  });
}

module.exports = {
  createLegacyBackedBot,
  createStatusService,
  createAutomationService,
  createAccountContext,
  createSingleAccountContext,
};
