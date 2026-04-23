const { prompt } = require('../cli/prompts');
const { runLauncher, renderSummaryScreen } = require('./screens');
const { chooseProfile, chooseAutoAllMode } = require('./menus');
const {
  renderSummaryBundle,
  renderProxyPanel,
  renderActionResult,
  renderMultiResultPanel,
  renderLoopPanel,
} = require('./panels');
const { color, C, theme, ANSI } = require('./theme');
const { box, progressBar, colorProgressBar } = require('./renderer');
const { summarizeAccounts } = require('../domain/summary');
const { createAccountContext, createSingleAccountContext } = require('../domain/context');
const { runStatusAll } = require('../orchestration/status-all');
const { runAutomationAll } = require('../orchestration/run-all');
const { runCampaignAll } = require('../orchestration/campaign-all');
const { runTrackAll } = require('../orchestration/track-all');
const { runMintAllRanksAll } = require('../orchestration/mint-all');
const { runFaucetLoop, runFaucetLoopAll } = require('../orchestration/faucet-loop');
const { loadAccountsConfig } = require('../config/accounts');
const { createConfiguredProxyRotation } = require('../addons/proxies');
const { promptMultiToggle, promptNumber, promptConfirm, promptSingleSelect } = require('./toggle');
const { StepTracker, LiveTracker, AccountProgressMap } = require('./tracker');
const { loadFeatureState, saveFeatureState, getFeaturesByCategory, buildAutoAllOptionsFromState, buildDefaultState } = require('../domain/features');

const S = theme.symbols;

function getProxyRotation() {
  return createConfiguredProxyRotation(loadAccountsConfig());
}

function makeContextFactory(args, proxyRotation) {
  return (accountName) => createAccountContext(accountName, {
    fastMode: !!args.fast,
    humanMode: !args.quiet,
    proxyRotation,
  });
}

// ─── Visual progress helpers ────────────────────────────

function renderFaucetLoopBanner(progressMap, totalAccounts, currentAccount) {
  const entries = Array.from(progressMap.entries());
  const doneCount = entries.filter(([, p]) => p.ok === true).length;
  const failCount = entries.filter(([, p]) => p.ok === false).length;

  const lines = [
    `${color(S.diamond, C.primary)} ${color('FAUCET LOOP ALL', `${ANSI.bold}${C.title}`)}`,
    ``,
    `  ${color('Overall:', C.label)} ${color(`${doneCount + failCount}/${totalAccounts}`, C.value)}`,
    `  ${color('Done:', C.label)}   ${color(String(doneCount), C.success)}  ${color('Fail:', C.label)} ${color(String(failCount), C.error)}`,
    ``,
  ];

  const maxVisible = 12;
  let visible = entries.slice(0, maxVisible);
  if (entries.length > maxVisible) {
    visible = entries.slice(0, maxVisible - 1);
    const remaining = entries.length - visible.length;
    visible.push([null, { label: `... and ${remaining} more` }]);
  }

  for (const [name, p] of visible) {
    if (name === null) {
      lines.push(`  ${color(p.label, C.muted)}`);
      continue;
    }
    const isCurrent = name === currentAccount;
    const prefix = isCurrent ? color('›', C.primary) : ' ';
    if (p.ok === true) {
      lines.push(`  ${prefix} ${color('✓', C.success)} ${color(name, C.muted)} ${color('done', C.success)}`);
    } else if (p.ok === false) {
      lines.push(`  ${prefix} ${color('✗', C.error)} ${color(name, C.muted)} ${color(p.error || 'failed', C.errorText)}`);
    } else if (p.cycle) {
      lines.push(`  ${prefix} ${color('◐', C.primary)} ${color(name, C.value)} cycle ${color(String(p.cycle), C.primary)} ${color(p.status || '', C.muted)}`);
    } else {
      lines.push(`  ${prefix} ${color('○', C.muted)} ${color(name, C.muted)} ${color('queued', C.muted)}`);
    }
  }

  console.clear();
  process.stdout.write(`${box(`${S.diamond} Faucet Loop`, lines, 72)}\n`);
}

function renderAccountRow({ account, index, total, ok, error, step, message }) {
  const idx = `${String(index + 1).padStart(2)}/${String(total).padStart(2)}`;
  if (ok === undefined) {
    return `  ${color(S.tri, C.primary)} ${color(account, C.value)} ${color(`(${idx})`, C.muted)} ${color(step || 'starting', C.primary)} ${message ? color(`| ${message}`, C.muted) : ''}`;
  }
  const sym = ok ? color(S.ok, C.success) : color(S.fail, C.error);
  const err = error ? ` ${color(error, C.errorText)}` : '';
  return `  ${sym} ${color(account, C.value)} ${color(`(${idx})`, C.muted)}${err}`;
}

// ─── Feature Toggle Menu ────────────────────────────────

async function buildAutoAllOptionsInteractive(promptFn) {
  const preset = await chooseAutoAllMode(promptFn);
  if (preset === 'default') {
    return { ...buildAutoAllOptionsFromState(buildDefaultState()), profile: 'balanced' };
  }

  // Load persistent feature state
  let featureState = loadFeatureState();

  // Build flat toggle items (no section headers)
  const groups = getFeaturesByCategory(featureState);
  const toggleItems = [];
  for (const group of groups) {
    for (const item of group.items) {
      toggleItems.push({ label: item.label, value: item.id, checked: item.enabled, description: item.description });
    }
  }

  const selected = await promptMultiToggle('Toggle Features (Space to toggle, Enter to confirm)', toggleItems);

  // Update feature state
  const enabledSet = new Set(selected);
  for (const feat of toggleItems) {
    if (feat.type !== 'header' && feat.value) {
      featureState[feat.value] = enabledSet.has(feat.value);
    }
  }
  saveFeatureState(featureState);

  // Build automation options from toggles
  const options = buildAutoAllOptionsFromState(featureState);

  // Extra config for enabled chain features
  let txCount = 3;
  let txAmount = '0.0001';
  if (options.txGrind) {
    txCount = await promptNumber(promptFn, 'TX grind count', 3);
    txAmount = (await promptFn('TX grind amount [0.0001]: ')) || '0.0001';
  }

  let stakeAmount = null;
  if (options.stake) {
    stakeAmount = (await promptFn('Stake amount [0.01]: ')) || '0.01';
  }

  let burnAmount = null;
  if (options.burn) {
    burnAmount = (await promptFn('Burn amount [0.01]: ')) || '0.01';
  }

  let profile = 'balanced';
  if (options.strategy) {
    profile = (await chooseProfile(promptFn)) || 'balanced';
  }

  return {
    ...options,
    txCount,
    txAmount,
    stakeAmount,
    burnAmount,
    profile,
  };
}

function printAutomationReview(target, options) {
  const lines = [
    `${color('Target:', C.label)} ${color(target, C.value)}`,
    '',
    ...Object.entries(options).map(([k, v]) => {
      const val = v === true ? color('ON', C.success) : v === false ? color('OFF', C.muted) : color(String(v), C.value);
      return `  ${color(k.padEnd(14), C.label)} ${val}`;
    }),
  ];
  console.log(`\n${box(`${S.star} Automation Review`, lines, 56)}\n`);
}

// ─── Live Single-Account Automation ─────────────────────

async function runSingleAccountAutomation(context, options, { useVisual = false, quiet = false } = {}) {
  const tracker = new StepTracker({ title: `Automation — ${context.accountName || 'account'}`, width: 96 });
  context.bot.tracker = tracker;

  let live = null;
  if (useVisual) {
    live = new LiveTracker(tracker, { fps: 4 });
    live.start();
  }

  try {
    const result = await context.services.automation.run(options, ({ step, message }) => {
      if (!quiet && step && message) {
        // Progress callback from automation service
      }
    });
    if (live) live.stop();
    return { ok: true, result, tracker };
  } catch (error) {
    if (live) live.stop();
    const step = tracker.add('Fatal error');
    tracker.fail(step.id, error);
    return { ok: false, error: error.message, tracker };
  }
}

// ─── Live Multi-Account Automation ──────────────────────

async function runMultiAccountAutomation({ names, contextFactory, options, args, useVisual, quiet }) {
  const totalAccounts = names.length;
  const progressMap = new AccountProgressMap({ title: 'Multi-Account Automation', width: 96, accountNames: names });

  // Throttle visual renders so fast mode doesn't spend all its time clearing the terminal
  let renderPending = false;
  let lastRender = 0;
  const RENDER_INTERVAL_MS = args.fast ? 300 : 150;
  function throttledRender() {
    if (!useVisual) return;
    const now = Date.now();
    if (now - lastRender < RENDER_INTERVAL_MS) {
      if (!renderPending) {
        renderPending = true;
        setTimeout(() => {
          renderPending = false;
          lastRender = Date.now();
          console.clear();
          process.stdout.write(`${progressMap.render()}\n`);
        }, RENDER_INTERVAL_MS - (now - lastRender));
      }
      return;
    }
    lastRender = now;
    console.clear();
    process.stdout.write(`${progressMap.render()}\n`);
  }

  const result = await runAutomationAll({
    contextFactory,
    options,
    selected: args.accounts || undefined,
    concurrency: args.concurrency || 1,
    onStart: ({ account, index, total }) => {
      progressMap.createTracker(account, `Automation — ${account}`);
      progressMap.setCurrent(account);
      if (useVisual) {
        throttledRender();
      } else if (!quiet) {
        console.log(renderAccountRow({ account, index, total, step: 'starting', message: '' }));
      }
    },
    onComplete: ({ account, index, total, ok, error }) => {
      const tracker = progressMap.getTracker(account);
      if (tracker) {
        if (ok) {
          const step = tracker.add('Complete');
          tracker.finish(step.id);
        } else {
          const step = tracker.add('Failed');
          tracker.fail(step.id, new Error(error));
        }
      }
      if (ok) {
        progressMap.setDone(account);
      } else {
        const lastErrStep = tracker?.steps?.slice().reverse().find((s) => s.status === 'error');
        progressMap.setError(account, { failedStep: lastErrStep?.label || progressMap.states.get(account)?.label || 'unknown', error });
      }
      progressMap.setCurrent(null);
      if (useVisual) {
        throttledRender();
      } else if (!quiet) {
        console.log(renderAccountRow({ account, index, total, ok, error }));
      }
    },
    onProgress: ({ account, step, message, total, stepIndex, key, detail }) => {
      // Update lightweight dashboard state with human-readable progress
      progressMap.setState(account, { label: step, index: stepIndex, total });
      progressMap.setCurrent(account);
      if (useVisual) {
        throttledRender();
      } else if (!quiet && step) {
        const idx = stepIndex ?? '?';
        const tot = total ?? '?';
        console.log(`    ${color(S.dot, C.muted)} ${color(account, C.label)} ${color(S.pipe, C.muted)} ${color(`Step ${idx}/${tot}: ${step}`, C.primary)} ${detail ? color(`| ${detail}`, C.muted) : ''}`);
      }
    },
    prepareContext: (accountName, context) => {
      const tracker = progressMap.getTracker(accountName);
      if (tracker) context.bot.tracker = tracker;
      const proxyLabel = context.proxy?.label || context.bot?.proxy?.label || 'none';
      const proxySource = context.proxySource || context.bot?.proxySource || 'none';
      progressMap.setProxy(accountName, {
        label: proxyLabel,
        source: proxySource,
        healthy: true,
      });
    },
  });

  if (useVisual) console.clear();
  console.log(renderSummaryBundle(summarizeAccounts(result.results)));
  return result;
}

// ─── Main launcher loop ─────────────────────────────────

async function runInteractiveLauncher(context, args = {}) {
  const proxyRotation = args.proxyRotation || getProxyRotation();
  const contextFactory = makeContextFactory(args, proxyRotation);

  while (true) {
    const mode = await runLauncher(context, (q) => prompt(q));
    if (!mode || mode === 'exit') break;

    try {
      if (mode === 'account') {
        const config = loadAccountsConfig();
        const names = Object.keys(config.accounts);
        if (!names.length) { console.log(`  ${color('No accounts configured.', C.muted)}`); await prompt('\nPress Enter to continue...'); continue; }
        console.log('\n  Saved accounts:');
        names.forEach((name, idx) => console.log(`  ${idx + 1}. ${name}${name === config.default ? ' (default)' : ''}`));
        const answer = await prompt(`  Choose account [${config.default || names[0]}]: `);
        if (answer) {
          const index = Number(answer);
          const selected = (Number.isInteger(index) && index >= 1 && index <= names.length) ? names[index - 1] : (config.accounts[answer] ? answer : null);
          if (selected) {
            context = await createAccountContext(selected, { fastMode: !!args.fast, humanMode: !args.quiet, proxyRotation });
            console.log(`  ${color(S.ok, C.success)} Switched to ${color(selected, C.primary)}`);
          }
        }
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'summary') {
        const result = await runStatusAll({
          contextFactory,
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
        console.log(renderSummaryBundle(summarizeAccounts(result.results)));
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'manual') {
        const actions = ['sync', 'explore', 'tasks', 'badges', 'faucet', 'crates', 'mint-scan', 'receive', 'mesh', 'back'];
        console.log('\n  Manual actions:');
        actions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
        const choice = await prompt('  Choose action: ');
        const actionIndex = Number(choice) - 1;
        if (actionIndex >= 0 && actionIndex < actions.length - 1) {
          const action = actions[actionIndex];
          const tracker = new StepTracker({ title: `Manual — ${action}`, width: 88 });
          context.bot.tracker = tracker;
          if (action === 'sync') { const result = await context.bot.sync(); console.log(JSON.stringify(result, null, 2)); }
          else if (action === 'explore') await context.bot.runExploration();
          else if (action === 'tasks') await context.bot.runSocialTasks();
          else if (action === 'badges') await context.bot.runBadgeClaim();
          else if (action === 'faucet') await context.bot.runFaucet();
          else if (action === 'crates') await context.bot.runCrates();
          else if (action === 'mint-scan') { const rows = await context.bot.getMintableRanks(); console.log(JSON.stringify(rows, null, 2)); }
          else if (action === 'receive') { const result = await context.bot.receiveTransactions({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
          else if (action === 'mesh') { const result = await context.bot.txMesh({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
          if (tracker.steps.length > 0) console.log(`\n${tracker.render()}\n`);
        }
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'auto') {
        const options = await buildAutoAllOptionsInteractive((q) => prompt(q));
        const reviewTarget = context.accountName || 'default account';
        printAutomationReview(reviewTarget, options);
        const go = await promptConfirm((q) => prompt(q), 'Start automation?');
        if (!go) { console.log(color('  Cancelled.', C.muted)); await prompt('\nPress Enter to continue...'); continue; }

        const useVisual = process.stdout.isTTY && !args.quiet;
        const result = await runSingleAccountAutomation(context, options, { useVisual, quiet: args.quiet });
        if (!useVisual && result.tracker) console.log(`\n${result.tracker.render()}\n`);
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'auto-all') {
        const options = await buildAutoAllOptionsInteractive((q) => prompt(q));
        const config = loadAccountsConfig();
        const names = Object.keys(config.accounts);
        const reviewTarget = `${names.length} accounts`;
        printAutomationReview(reviewTarget, options);
        const go = await promptConfirm((q) => prompt(q), 'Start automation across all accounts?');
        if (!go) { console.log(color('  Cancelled.', C.muted)); await prompt('\nPress Enter to continue...'); continue; }

        const useVisual = process.stdout.isTTY && !args.quiet;
        await runMultiAccountAutomation({ names, contextFactory, options, args, useVisual, quiet: args.quiet });
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'faucet-loop') {
        const durationHours = await promptNumber((q) => prompt(q), 'Duration hours', 24);
        const intervalMinutes = await promptNumber((q) => prompt(q), 'Interval minutes', 60);
        const result = await runFaucetLoop(context.bot, { durationHours, intervalMinutes });
        console.log(renderLoopPanel('Faucet Loop', result));
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'faucet-loop-all') {
        const durationHours = await promptNumber((q) => prompt(q), 'Duration hours', 24);
        const intervalMinutes = await promptNumber((q) => prompt(q), 'Interval minutes', 60);
        const useVisual = process.stdout.isTTY && !args.quiet;
        const progressMap = new Map();
        const config = loadAccountsConfig();
        const totalAccounts = Object.keys(config.accounts).length;

        // Throttle banner renders in fast mode
        let faucetRenderPending = false;
        let faucetLastRender = 0;
        const FAUCET_RENDER_MS = args.fast ? 400 : 200;
        function throttledFaucetRender(currentAccount) {
          const now = Date.now();
          if (now - faucetLastRender < FAUCET_RENDER_MS) {
            if (!faucetRenderPending) {
              faucetRenderPending = true;
              setTimeout(() => {
                faucetRenderPending = false;
                faucetLastRender = Date.now();
                renderFaucetLoopBanner(progressMap, totalAccounts, currentAccount);
              }, FAUCET_RENDER_MS - (now - faucetLastRender));
            }
            return;
          }
          faucetLastRender = now;
          renderFaucetLoopBanner(progressMap, totalAccounts, currentAccount);
        }

        const result = await runFaucetLoopAll({
          contextFactory,
          durationHours,
          intervalMinutes,
          onProgress: useVisual
            ? ({ account, cycle, status, detail }) => {
                const p = progressMap.get(account) || {};
                progressMap.set(account, { ...p, cycle, status, detail });
                throttledFaucetRender(account);
              }
            : ({ account, cycle, status, detail }) => {
                if (!args.quiet) console.log(`  ${color(S.dot, C.muted)} ${color(account, C.label)} cycle ${cycle} ${color(status, C.primary)} ${detail ? color(`| ${detail}`, C.muted) : ''}`);
              },
        });

        if (useVisual) console.clear();
        console.log(renderMultiResultPanel('Faucet Loop All', result));
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'advanced') {
        const tools = ['tx-grind', 'receive', 'burn', 'stake', 'mint-scan', 'mint-all', 'track', 'campaign', 'faucet-loop', 'back'];
        console.log('\n  Advanced tools:');
        tools.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
        const choice = await prompt('  Choose tool: ');
        const toolIndex = Number(choice) - 1;
        if (toolIndex >= 0 && toolIndex < tools.length - 1) {
          const tool = tools[toolIndex];
          const tracker = new StepTracker({ title: `Advanced — ${tool}`, width: 88 });
          context.bot.tracker = tracker;
          if (tool === 'tx-grind') await context.bot.grindTransactions({ count: 3, amount: '0.0001' });
          else if (tool === 'receive') { const result = await context.bot.receiveTransactions({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'burn') { const amount = (await prompt('Burn amount [0.01]: ')) || '0.01'; console.log(JSON.stringify(await context.bot.burnForQE(amount), null, 2)); }
          else if (tool === 'stake') { const amount = (await prompt('Stake amount [0.01]: ')) || '0.01'; console.log(JSON.stringify(await context.bot.stakeDacc(amount), null, 2)); }
          else if (tool === 'mint-scan') { const rows = await context.bot.getMintableRanks(); console.log(JSON.stringify(rows, null, 2)); }
          else if (tool === 'mint-all') { const result = await context.bot.mintAllEligibleRanks(); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'track') { const result = await context.bot.snapshotTracking(); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'campaign') { const profile = (await chooseProfile((q) => prompt(q))) || 'balanced'; console.log(JSON.stringify(await context.bot.runCampaign({ loops: 1, strategyProfile: profile, intervalMinutes: 0 }), null, 2)); }
          else if (tool === 'faucet-loop') { const result = await runFaucetLoop(context.bot, { durationHours: 24, intervalMinutes: 60 }); console.log(JSON.stringify(result, null, 2)); }
          if (tracker.steps.length > 0) console.log(`\n${tracker.render()}\n`);
        }
        await prompt('\nPress Enter to continue...');
      }
    } catch (error) {
      console.log(`  ${color(S.fail, C.error)} ${color(error.message, C.errorText)}`);
      await prompt('\nPress Enter to continue...');
    }
  }
}

module.exports = { runInteractiveLauncher };
