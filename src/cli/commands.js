const fs = require('fs');
const path = require('path');
const { deriveWalletAddress } = require('../chain/wallet');
const { upsertAccount, loadAccountsConfig } = require('../config/accounts');
const { prompt } = require('./prompts');
const { DACBot } = require('../core/bot');
const { createConfiguredProxyRotation } = require('../addons/proxies');
const { createAccountContext, createSingleAccountContext } = require('../domain/context');
const { runStatusAll } = require('../orchestration/status-all');
const { runAutomationAll } = require('../orchestration/run-all');
const { runCampaignAll } = require('../orchestration/campaign-all');
const { runTrackAll } = require('../orchestration/track-all');
const { runMintAllRanksAll } = require('../orchestration/mint-all');
const { runReceiveAll } = require('../orchestration/receive-all');
const { runTxMeshAll } = require('../orchestration/mesh-all');
const { runFaucetLoop, runFaucetLoopAll } = require('../orchestration/faucet-loop');
const { runInteractiveLauncher } = require('../tui/launcher');
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
const { color, C, theme } = require('../tui/theme');
const S = theme.symbols;

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

function makeContextFactory(args, proxyRotation) {
  return (accountName) => createAccountContext(accountName, {
    fastMode: !!args.fast,
    humanMode: !args.quiet,
    proxyRotation,
  });
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

  console.log(`${color(S.ok, C.success)} Saved account ${color(accountName, C.primary)}`);
}

async function handleStatusAll(args) {
  const proxyRotation = getSharedProxyRotation(args);
  const result = await runStatusAll({
    contextFactory: makeContextFactory(args, proxyRotation),
    concurrency: 4,
    onStart: ({ account, index, total }) => {
      if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
    },
    onComplete: ({ account, index, total, ok, error }) => {
      if (args.quiet) return;
      console.log(ok
        ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
        : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
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
    contextFactory: makeContextFactory(args, proxyRotation),
    options,
    onStart: ({ account, index, total }) => {
      if (liveProxyDashboard) setProgress(account, `running ${index + 1}/${total}`, 'starting');
      else if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
    },
    onComplete: ({ account, index, total, ok, error }) => {
      if (liveProxyDashboard) setProgress(account, ok ? `done ${index + 1}/${total}` : `failed ${index + 1}/${total}`, ok ? 'complete' : error);
      else if (!args.quiet) console.log(ok
        ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
        : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
    },
    onProgress: ({ account, step, message }) => {
      if (liveProxyDashboard && (step || message)) setProgress(account, step || 'running', message || '');
      else if (!args.quiet && step && message) console.log(`    ${color(S.dot, C.muted)} ${color(account, C.label)} ${color(S.pipe, C.muted)} ${color(step, C.primary)} ${color(S.pipe, C.muted)} ${color(message, C.label)}`);
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
    if (!args.quiet && step && message) console.log(`  ${color(S.tri, C.primary)} ${color(step, C.value)} ${color(S.pipe, C.muted)} ${color(message, C.label)}`);
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
    const contextFactory = makeContextFactory(args, proxyRotation);
    const all = await runStatusAll({ contextFactory, concurrency: 1 });
    const rows = await Promise.all(all.accounts.map(async (account) => {
      try {
        const context = await contextFactory(account);
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
    console.log(`${color(S.ok, C.success)} Safety state cleared.`);
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
    console.log(`${color(S.ok, C.success)} Created ${color(result.wallets.length, C.primary)} child wallets in ${color(result.file, C.value)}`);
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
    const proxyRotation = getSharedProxyRotation(args);
    const result = await runReceiveAll({
      contextFactory: makeContextFactory(args, proxyRotation),
      count: args.txCount,
      amount: args.txAmount,
      onStart: ({ account, index, total }) => {
        if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
      },
      onComplete: ({ account, index, total, ok, error }) => {
        if (!args.quiet) console.log(ok
          ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
          : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
      },
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
    const proxyRotation = getSharedProxyRotation(args);
    const result = await runTxMeshAll({
      contextFactory: makeContextFactory(args, proxyRotation),
      count: args.txCount,
      amount: args.txAmount,
      onStart: ({ account, index, total }) => {
        if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
      },
      onComplete: ({ account, index, total, ok, error }) => {
        if (!args.quiet) console.log(ok
          ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
          : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
      },
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
    const proxyRotation = getSharedProxyRotation(args);
    const result = await runMintAllRanksAll({
      contextFactory: makeContextFactory(args, proxyRotation),
      onStart: ({ account, index, total }) => {
        if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
      },
      onComplete: ({ account, index, total, ok, error }) => {
        if (!args.quiet) console.log(ok
          ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
          : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
      },
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
    const proxyRotation = getSharedProxyRotation(args);
    const result = await runTrackAll({
      contextFactory: makeContextFactory(args, proxyRotation),
      onStart: ({ account, index, total }) => {
        if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
      },
      onComplete: ({ account, index, total, ok, error }) => {
        if (!args.quiet) console.log(ok
          ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
          : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
      },
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
    const proxyRotation = getSharedProxyRotation(args);
    const result = await runCampaignAll({
      contextFactory: makeContextFactory(args, proxyRotation),
      profile: args.profile || 'balanced',
      onStart: ({ account, index, total }) => {
        if (!args.quiet) console.log(`  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`);
      },
      onComplete: ({ account, index, total, ok, error }) => {
        if (!args.quiet) console.log(ok
          ? `  ${color(S.ok, C.success)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)}`
          : `  ${color(S.fail, C.error)} ${color(account, C.value)} ${color(`(${index + 1}/${total})`, C.muted)} ${color(error, C.errorText)}`);
      },
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
    const result = await runFaucetLoopAll({
      contextFactory: makeContextFactory(args, proxyRotation),
      durationHours: args.durationHours || 24,
      intervalMinutes: args.interval || 60,
      onProgress: liveProxyDashboard ? ({ account, status, detail }) => setProgress(account, status, detail) : null,
    });
    printStructured(args, result, (payload) => [
      renderMultiResultPanel('Faucet Loop All', payload),
      renderProxyPanel(payload.proxyState || proxyRotation?.snapshot?.()),
    ].filter(Boolean).join('\n'));
    return;
  }

  if (command === 'manual') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log('Manual mode needs a TTY. Use direct commands instead.');
      return;
    }
    const proxyRotation = getSharedProxyRotation(args);
    const context = await createSingleAccountContext({ ...args, proxyRotation });
    await runInteractiveLauncher(context, { ...args, proxyRotation });
    return;
  }

  if (command === 'menu' || command === 'interactive') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log('Interactive menu needs a TTY. Use direct commands instead.');
      return;
    }
    const proxyRotation = getSharedProxyRotation(args);
    const context = await createSingleAccountContext({ ...args, proxyRotation });
    await runInteractiveLauncher(context, { ...args, proxyRotation });
    return;
  }

  if (command === 'loop') {
    const bot = createDirectBot(args);
    while (true) {
      try {
        await bot.run(buildRunOptions(args));
        console.log(`  ${color(S.circle, C.muted)} Sleeping ${color(`${args.interval}m`, C.label)}...`);
        await new Promise((resolve) => setTimeout(resolve, args.interval * 60 * 1000));
      } catch (error) {
        console.error(`  ${color(S.fail, C.error)} ${color(error.message, C.errorText)}`);
        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
      }
    }
    return;
  }

  if (command === 'help') {
    const { printHelp } = require('./args');
    printHelp();
    return;
  }

  await handleRun({ ...args, command: 'run' });
}

module.exports = {
  runCommand,
  canUseLiveProxyDashboard,
};
