const fs = require('fs');
const path = require('path');
const { deriveWalletAddress } = require('../chain/wallet');
const { upsertAccount, loadAccountsConfig } = require('../config/accounts');
const { prompt } = require('./prompts');
const {
  DACBot,
  orchestrateCampaignAll,
  orchestrateTrackAll,
  orchestrateMintAllRanks,
  orchestrateReceiveAll,
  orchestrateTxMeshAll,
  runMenu,
  runManualActionMenu,
  runFaucetLoop,
  orchestrateFaucetLoopAll,
} = require('../legacy/runtime');
const { createConfiguredProxyRotation } = require('../addons/proxies');
const { createAccountContext, createSingleAccountContext } = require('../domain/context');
const { runStatusAll } = require('../orchestration/status-all');
const { runAutomationAll } = require('../orchestration/run-all');
const { summarizeAccounts } = require('../domain/summary');
const {
  renderSummary,
  renderSummaryBundle,
  renderFailuresPanel,
  renderMultiResultPanel,
  renderStatusPanel,
  renderActionResult,
  renderTxPanel,
  renderLoopPanel,
  renderProxyPanel,
  renderTrackingPanel,
  renderCampaignPanel,
  renderMintAllPanel,
  renderWalletLoginPanel,
  renderReceivePanel,
  renderMeshPanel,
  renderMintRankPanel,
  renderMintScan,
} = require('../tui/panels');

const DIRECT_COMMANDS = new Set([
  'manual',
  'strategy',
  'menu',
  'interactive',
  'wallet-login',
  'wallet-login-all',
  'loop',
  'tx-grind',
  'receive',
  'receive-all',
  'tx-mesh',
  'tx-mesh-all',
  'burn',
  'stake',
  'child-wallets',
  'mint-scan',
  'mint-rank',
  'mint-all-ranks',
  'mint-all-ranks-all',
  'track',
  'track-all',
  'campaign',
  'campaign-all',
  'faucet-loop',
  'faucet-loop-all',
  'human-status',
  'clear-safety',
  'help',
]);

function buildRunOptions(args, overrides = {}) {
  return {
    crates: true,
    faucet: true,
    tasks: true,
    badges: true,
    txGrind: false,
    txCount: args.txCount,
    txAmount: args.txAmount,
    burnAmount: args.burnAmount,
    stakeAmount: args.stakeAmount,
    strategy: !!args.strategyFlag,
    profile: args.profile,
    ...overrides,
  };
}

function getSharedProxyRotation(args) {
  return args.proxyRotation || createConfiguredProxyRotation(loadAccountsConfig());
}

function getProxyOverrides(args) {
  const proxyRotation = getSharedProxyRotation(args);
  return proxyRotation ? { proxyRotation } : {};
}

function createDirectBot(args) {
  return new DACBot({
    cookies: args.cookies,
    csrf: args.csrf,
    privateKey: args.privateKey,
    account: args.account,
    verbose: !args.quiet,
    humanMode: args.humanMode !== false,
    fastMode: !!args.fast,
    ...getProxyOverrides(args),
  });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printStructured(args, fallback, renderer) {
  if (args.json) {
    printJson(fallback);
    return;
  }
  console.log(renderer(fallback));
}

function canUseLiveProxyDashboard(proxyRotation) {
  return !!(process.stdout.isTTY && proxyRotation?.snapshot && proxyRotation.enabled);
}

function redrawLiveDashboard(sections = []) {
  if (!process.stdout.isTTY) return;
  console.clear();
  const content = sections.filter(Boolean).join('\n\n');
  if (content) process.stdout.write(`${content}\n`);
}

function createLiveProxyRenderer(title, proxyRotation, progressRows = []) {
  return () => {
    if (!canUseLiveProxyDashboard(proxyRotation)) return;
    const progressLines = progressRows.length
      ? progressRows.map((row) => `${row.account}: ${row.status}${row.detail ? ` | ${row.detail}` : ''}`)
      : ['waiting for accounts...'];
    redrawLiveDashboard([
      renderActionResult(title, progressLines),
      renderProxyPanel(proxyRotation.snapshot()),
    ]);
  };
}

function buildLegacyArgv(args) {
  const argv = ['node', 'src/legacy/runtime.js'];
  if (args.command) argv.push(args.command);
  if (args.account) argv.push('--account', args.account);
  if (args.privateKey) argv.push('--private-key', args.privateKey);
  if (args.cookies) argv.push('--cookies', args.cookies);
  if (args.csrf) argv.push('--csrf', args.csrf);
  if (args.interval != null) argv.push('--interval', String(args.interval));
  if (args.durationHours != null) argv.push('--duration-hours', String(args.durationHours));
  if (args.txCount != null) argv.push('--tx-count', String(args.txCount));
  if (args.txAmount) argv.push('--tx-amount', String(args.txAmount));
  if (args.burnAmount) argv.push('--burn', String(args.burnAmount));
  if (args.stakeAmount) argv.push('--stake', String(args.stakeAmount));
  if (args.profile) argv.push('--profile', String(args.profile));
  if (args.rankKey) argv.push('--rank-key', String(args.rankKey));
  if (args.quiet) argv.push('--quiet');
  if (args.fast) argv.push('--fast');
  if (args.json) argv.push('--json');
  if (args.strategyFlag) argv.push('--strategy');
  return argv;
}

async function handleSetup(args) {
  const accountName = args.account || await prompt('Account name: ');
  const privateKey = args.privateKey || await prompt('Private key: ', { silent: true });
  const cookies = args.cookies || await prompt('Cookies (optional): ');
  const csrf = args.csrf || await prompt('CSRF (optional): ');

  upsertAccount(accountName, {
    privateKey: privateKey || undefined,
    cookies: cookies || undefined,
    csrf: csrf || undefined,
    wallet: privateKey ? deriveWalletAddress(privateKey) : undefined,
    updatedAt: new Date().toISOString(),
  }, { makeDefault: true, preservePrivateKey: false });

  const configPath = path.join(process.cwd(), 'dac.config.json');
  if (fs.existsSync(configPath)) {
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {}
  }

  console.log(`Saved account ${accountName}`);
}

async function handleStatusAll(args) {
  const proxyRotation = getSharedProxyRotation(args);
  const result = await runStatusAll({
    contextFactory: (accountName) => createAccountContext(accountName, {
      fastMode: !!args.fast,
      humanMode: !args.quiet,
      proxyRotation,
    }),
    concurrency: 4,
    onStart: ({ account, index, total }) => {
      if (!args.quiet) console.log(`Loading ${account} (${index + 1}/${total})...`);
    },
    onComplete: ({ account, index, total, ok, error }) => {
      if (args.quiet) return;
      console.log(ok
        ? `Loaded ${account} (${index + 1}/${total})`
        : `Failed ${account} (${index + 1}/${total}) - ${error}`);
    },
  });
  const parts = [renderSummaryBundle(summarizeAccounts(result.results))];
  if (proxyRotation?.snapshot) parts.push(renderProxyPanel(proxyRotation.snapshot()));
  console.log(parts.filter(Boolean).join('\n'));
}

async function handleRunAll(args) {
  const proxyRotation = getSharedProxyRotation(args);
  const liveProxyDashboard = canUseLiveProxyDashboard(proxyRotation) && !args.quiet;
  const progressRows = [];
  const renderLive = createLiveProxyRenderer('Auto All Proxy Status', proxyRotation, progressRows);
  const setProgress = (account, status, detail = '') => {
    const existing = progressRows.find((row) => row.account === account);
    if (existing) {
      existing.status = status;
      existing.detail = detail;
    } else {
      progressRows.push({ account, status, detail });
    }
    if (liveProxyDashboard) renderLive();
  };
  const options = {
    tasks: true,
    badges: true,
    faucet: false,
    crates: false,
    mintScan: true,
    txGrind: false,
    receive: false,
    mesh: false,
    strategy: !!args.strategyFlag,
    profile: args.profile,
    txCount: args.txCount,
    txAmount: args.txAmount,
    burnAmount: args.burnAmount,
    stakeAmount: args.stakeAmount,
  };
  const result = await runAutomationAll({
    contextFactory: (accountName) => createAccountContext(accountName, {
      fastMode: !!args.fast,
      humanMode: !args.quiet,
      proxyRotation,
    }),
    options,
    onStart: ({ account, index, total }) => {
      if (liveProxyDashboard) setProgress(account, `running ${index + 1}/${total}`, 'starting');
      else if (!args.quiet) console.log(`Running ${account} (${index + 1}/${total})...`);
    },
    onComplete: ({ account, index, total, ok, error }) => {
      if (liveProxyDashboard) setProgress(account, ok ? `done ${index + 1}/${total}` : `failed ${index + 1}/${total}`, ok ? 'complete' : error);
      else if (!args.quiet) console.log(ok
        ? `Done ${account} (${index + 1}/${total})`
        : `Failed ${account} (${index + 1}/${total}) - ${error}`);
    },
    onProgress: ({ account, step, message }) => {
      if (liveProxyDashboard && (step || message)) setProgress(account, step || 'running', message || '');
      else if (!args.quiet && step && message) console.log(`  ${account} | ${step} | ${message}`);
    },
  });
  const parts = [renderSummaryBundle(summarizeAccounts(result.results))];
  if (proxyRotation?.snapshot) parts.push(renderProxyPanel(proxyRotation.snapshot()));
  console.log(parts.filter(Boolean).join('\n'));
}

async function handleStatus(args) {
  const context = await createSingleAccountContext({
    ...args,
    ...getProxyOverrides(args),
  });
  const status = await context.services.statusService.fetchNormalizedStatus();
  const payload = {
    ...status,
    signer: context.wallet?.address || null,
  };
  printStructured(args, payload, renderStatusPanel);
}

async function handleRun(args) {
  const context = await createSingleAccountContext({
    ...args,
    ...getProxyOverrides(args),
  });
  const options = {
    crates: true,
    faucet: true,
    tasks: true,
    badges: true,
    txGrind: false,
    txCount: args.txCount,
    txAmount: args.txAmount,
    burnAmount: args.burnAmount,
    stakeAmount: args.stakeAmount,
    strategy: !!args.strategyFlag,
    profile: args.profile,
  };
  const result = await context.services.automation.run(options, ({ step, message }) => {
    if (!args.quiet && step && message) console.log(`${step} | ${message}`);
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
}

async function runCommand(args) {
  const command = args.command || 'run';

  if (command === 'setup') {
    await handleSetup(args);
    return;
  }

  if (command === 'status') {
    await handleStatus(args);
    return;
  }

  if (command === 'status-all') {
    await handleStatusAll(args);
    return;
  }

  if (command === 'run') {
    await handleRun(args);
    return;
  }

  if (command === 'run-all') {
    await handleRunAll(args);
    return;
  }

  if (command === 'wallet-login') {
    const bot = createDirectBot(args);
    const result = await bot.walletLogin(true);
    if (!args.quiet) {
      printStructured(args, { ok: true, wallet: bot.walletAddress, auth: result }, renderWalletLoginPanel);
    }
    return;
  }

  if (command === 'wallet-login-all') {
    const proxyRotation = getSharedProxyRotation(args);
    const all = await runStatusAll({
      contextFactory: (accountName) => createAccountContext(accountName, {
        fastMode: !!args.fast,
        humanMode: !args.quiet,
        proxyRotation,
      }),
      concurrency: 1,
    });
    const rows = await Promise.all(all.accounts.map(async (account) => {
      try {
        const context = await createAccountContext(account, {
          fastMode: !!args.fast,
          humanMode: !args.quiet,
          proxyRotation,
        });
        return {
          account,
          ok: true,
          proxy: context.proxy,
          result: { wallet: context.bot.walletAddress, auth: await context.bot.walletLogin(true) },
        };
      } catch (error) {
        return { account, ok: false, error: error.message };
      }
    }));
    console.log([renderSummary(summarizeAccounts(rows)), renderFailuresPanel(rows.filter((row) => !row.ok))].filter(Boolean).join('\n'));
    return;
  }

  if (command === 'clear-safety') {
    const bot = createDirectBot(args);
    bot.clearSafety();
    console.log('✅ Safety state cleared.');
    return;
  }

  if (command === 'human-status') {
    const bot = createDirectBot(args);
    printJson({ humanMode: bot.humanMode, safety: bot.safety || {} });
    return;
  }

  if (command === 'child-wallets') {
    const bot = createDirectBot(args);
    const result = bot.createChildWallets(args.txCount || 3);
    console.log(`✅ Created ${result.wallets.length} child wallets in ${result.file}`);
    return;
  }

  if (command === 'tx-grind') {
    const bot = createDirectBot(args);
    await bot.grindTransactions({ count: args.txCount, amount: args.txAmount });
    return;
  }

  if (command === 'receive') {
    const bot = createDirectBot(args);
    const result = await bot.receiveTransactions({ count: args.txCount, amount: args.txAmount });
    printStructured(args, result, (payload) => renderActionResult('Receive Quest', [
      `Count: ${payload.count ?? args.txCount}`,
      `Amount: ${payload.amount ?? args.txAmount}`,
      `Status: complete`,
    ]));
    return;
  }

  if (command === 'receive-all') {
    const result = await orchestrateReceiveAll({
      count: args.txCount,
      amount: args.txAmount,
      verbose: !args.quiet,
      humanMode: args.humanMode !== false,
      fastMode: !!args.fast,
      proxyRotation: getSharedProxyRotation(args),
    });
    printStructured(args, result, (payload) => renderMultiResultPanel('Receive All', payload));
    return;
  }

  if (command === 'tx-mesh') {
    const bot = createDirectBot(args);
    const result = await bot.txMesh({ count: args.txCount, amount: args.txAmount });
    printStructured(args, result, (payload) => renderActionResult('TX Mesh', [
      `Count: ${payload.count ?? args.txCount}`,
      `Amount: ${payload.amount ?? args.txAmount}`,
      `Status: complete`,
    ]));
    return;
  }

  if (command === 'tx-mesh-all') {
    const result = await orchestrateTxMeshAll({
      count: args.txCount,
      amount: args.txAmount,
      verbose: !args.quiet,
      humanMode: args.humanMode !== false,
      fastMode: !!args.fast,
      proxyRotation: getSharedProxyRotation(args),
    });
    printStructured(args, result, (payload) => renderMultiResultPanel('TX Mesh All', payload));
    return;
  }

  if (command === 'burn') {
    const bot = createDirectBot(args);
    if (!args.burnAmount) throw new Error('Use --burn <amount>');
    const result = await bot.burnForQE(args.burnAmount);
    printStructured(args, result, (payload) => renderTxPanel('Burn DACC', payload, { amount: args.burnAmount }));
    return;
  }

  if (command === 'stake') {
    const bot = createDirectBot(args);
    if (!args.stakeAmount) throw new Error('Use --stake <amount>');
    const result = await bot.stakeDacc(args.stakeAmount);
    printStructured(args, result, (payload) => renderTxPanel('Stake DACC', payload, { amount: args.stakeAmount }));
    return;
  }

  if (command === 'mint-scan') {
    const bot = createDirectBot(args);
    const rows = await bot.getMintableRanks();
    printStructured(args, { updatedAt: new Date().toISOString(), rows }, (payload) => renderMintScan(payload.rows));
    return;
  }

  if (command === 'mint-rank') {
    const bot = createDirectBot(args);
    if (!args.rankKey) throw new Error('Use --rank-key <rank_key>');
    const result = await bot.mintRank(args.rankKey);
    printStructured(args, result, (payload) => renderMintRankPanel(payload, args.rankKey));
    return;
  }

  if (command === 'mint-all-ranks') {
    const bot = createDirectBot(args);
    const result = await bot.mintAllEligibleRanks();
    printStructured(args, result, renderMintAllPanel);
    return;
  }

  if (command === 'mint-all-ranks-all') {
    const result = await orchestrateMintAllRanks({
      verbose: !args.quiet,
      humanMode: args.humanMode !== false,
      fastMode: !!args.fast,
      proxyRotation: getSharedProxyRotation(args),
    });
    printStructured(args, result, (payload) => renderMultiResultPanel('Mint All Ranks All', payload));
    return;
  }

  if (command === 'track') {
    const bot = createDirectBot(args);
    const result = await bot.snapshotTracking();
    printStructured(args, result, renderTrackingPanel);
    return;
  }

  if (command === 'track-all') {
    const result = await orchestrateTrackAll({
      verbose: !args.quiet,
      humanMode: args.humanMode !== false,
      fastMode: !!args.fast,
      proxyRotation: getSharedProxyRotation(args),
    });
    printStructured(args, result, (payload) => renderMultiResultPanel('Track All', payload));
    return;
  }

  if (command === 'campaign') {
    const bot = createDirectBot(args);
    const result = await bot.runCampaign({ loops: 1, strategyProfile: args.profile || 'balanced', intervalSeconds: 0 });
    printStructured(args, result, renderCampaignPanel);
    return;
  }

  if (command === 'campaign-all') {
    const result = await orchestrateCampaignAll({
      profile: args.profile || 'balanced',
      verbose: !args.quiet,
      humanMode: args.humanMode !== false,
      fastMode: !!args.fast,
      proxyRotation: getSharedProxyRotation(args),
    });
    printStructured(args, result, (payload) => renderMultiResultPanel('Campaign All', payload));
    return;
  }

  if (command === 'strategy') {
    const bot = createDirectBot(args);
    await bot.run(buildRunOptions(args, { strategy: true }));
    return;
  }

  if (command === 'faucet-loop') {
    const bot = createDirectBot(args);
    const result = await runFaucetLoop(bot, { durationHours: args.durationHours || 24, intervalMinutes: args.interval || 60 });
    printStructured(args, result, (payload) => renderLoopPanel('Faucet Loop', payload));
    return;
  }

  if (command === 'faucet-loop-all') {
    const proxyRotation = getSharedProxyRotation(args);
    const liveProxyDashboard = canUseLiveProxyDashboard(proxyRotation) && !args.quiet;
    const progressRows = [];
    const renderLive = createLiveProxyRenderer('Faucet Loop All Proxy Status', proxyRotation, progressRows);
    const setProgress = (account, status, detail = '') => {
      const existing = progressRows.find((row) => row.account === account);
      if (existing) {
        existing.status = status;
        existing.detail = detail;
      } else {
        progressRows.push({ account, status, detail });
      }
      if (liveProxyDashboard) renderLive();
    };
    const result = await orchestrateFaucetLoopAll({
      durationHours: args.durationHours || 24,
      intervalMinutes: args.interval || 60,
      verbose: !liveProxyDashboard && !args.quiet,
      humanMode: args.humanMode !== false,
      fastMode: !!args.fast,
      proxyRotation,
      onProgress: liveProxyDashboard ? ({ account, status, detail }) => setProgress(account, status, detail) : null,
    });
    printStructured(args, result, (payload) => [
      renderMultiResultPanel('Faucet Loop All', payload),
      renderProxyPanel(payload.proxyState || proxyRotation?.snapshot?.()),
    ].filter(Boolean).join('\n'));
    return;
  }

  if (command === 'manual') {
    const bot = createDirectBot(args);
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log('Manual mode needs a TTY. Use direct commands instead.');
      return;
    }
    await require('../legacy/runtime').runManualActionMenu(bot, args);
    return;
  }

  if (command === 'menu' || command === 'interactive') {
    const bot = createDirectBot(args);
    await runMenu(bot, args);
    return;
  }

  if (command === 'loop') {
    const bot = createDirectBot(args);
    while (true) {
      try {
        await bot.run(buildRunOptions(args));
        console.log(`Sleeping ${args.interval}m...`);
        await new Promise((resolve) => setTimeout(resolve, args.interval * 60 * 1000));
      } catch (error) {
        console.error(`Error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
      }
    }
    return;
  }

  if (DIRECT_COMMANDS.has(command)) {
    throw new Error(`Command not yet wired: ${command}`);
  }

  await handleRun({ ...args, command: 'run' });
}

module.exports = {
  runCommand,
  buildLegacyArgv,
  canUseLiveProxyDashboard,
};
