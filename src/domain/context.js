const { DACBot } = require('../core/bot');
const statusDomain = require('./status');

function createBot(accountName, overrides = {}) {
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
      const result = await bot.run({ ...options, progress: (evt) => {
        // Emit human-readable label as the primary step name, preserving metadata
        emit(evt.label || evt.key, {
          key: evt.key,
          total: evt.total,
          detail: evt.detail,
          stepIndex: evt.step,
          message: evt.label,
        });
      }});
      emit('complete', { message: 'automation run complete' });
      return result;
    },
  };
}

async function createAccountContext(accountName, overrides = {}) {
  const bot = createBot(accountName, overrides);
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
  createBot,
  createStatusService,
  createAutomationService,
  createAccountContext,
  createSingleAccountContext,
};
