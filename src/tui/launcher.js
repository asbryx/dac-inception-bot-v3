const { prompt } = require('../cli/prompts');
const { runLauncher, renderSummaryScreen } = require('./screens');
const { chooseProfile } = require('./menus');
const { renderSummaryBundle, renderProxyPanel, renderActionResult, renderMultiResultPanel } = require('./panels');
const { color, C, theme } = require('./theme');
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
          if (action === 'sync') { const result = await context.bot.sync(); console.log(JSON.stringify(result, null, 2)); }
          else if (action === 'explore') await context.bot.runExploration();
          else if (action === 'tasks') await context.bot.runSocialTasks();
          else if (action === 'badges') await context.bot.runBadgeClaim();
          else if (action === 'faucet') await context.bot.runFaucet();
          else if (action === 'crates') await context.bot.runCrates();
          else if (action === 'mint-scan') { const rows = await context.bot.getMintableRanks(); console.log(JSON.stringify(rows, null, 2)); }
          else if (action === 'receive') { const result = await context.bot.receiveTransactions({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
          else if (action === 'mesh') { const result = await context.bot.txMesh({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
        }
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'auto') {
        const options = { tasks: true, badges: true, faucet: true, crates: true, mintScan: true };
        console.log(`\n  ${color(S.tri, C.primary)} Running automation on ${color(context.accountName || 'default', C.value)}...`);
        await context.services.automation.run(options, ({ step, message }) => {
          if (!args.quiet && step && message) console.log(`  ${color(S.tri, C.primary)} ${color(step, C.value)} ${color(S.pipe, C.muted)} ${color(message, C.label)}`);
        });
        await prompt('\nPress Enter to continue...');
      }

      else if (mode === 'auto-all') {
        const result = await runAutomationAll({
          contextFactory,
          options: { tasks: true, badges: true, faucet: false, crates: false, mintScan: true },
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

      else if (mode === 'advanced') {
        const tools = ['tx-grind', 'receive', 'burn', 'stake', 'mint-scan', 'mint-all', 'track', 'campaign', 'faucet-loop', 'back'];
        console.log('\n  Advanced tools:');
        tools.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
        const choice = await prompt('  Choose tool: ');
        const toolIndex = Number(choice) - 1;
        if (toolIndex >= 0 && toolIndex < tools.length - 1) {
          const tool = tools[toolIndex];
          if (tool === 'tx-grind') await context.bot.grindTransactions({ count: 3, amount: '0.0001' });
          else if (tool === 'receive') { const result = await context.bot.receiveTransactions({ count: 1, amount: '0.0001' }); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'burn') { const amount = (await prompt('Burn amount [0.01]: ')) || '0.01'; console.log(JSON.stringify(await context.bot.burnForQE(amount), null, 2)); }
          else if (tool === 'stake') { const amount = (await prompt('Stake amount [0.01]: ')) || '0.01'; console.log(JSON.stringify(await context.bot.stakeDacc(amount), null, 2)); }
          else if (tool === 'mint-scan') { const rows = await context.bot.getMintableRanks(); console.log(JSON.stringify(rows, null, 2)); }
          else if (tool === 'mint-all') { const result = await context.bot.mintAllEligibleRanks(); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'track') { const result = await context.bot.snapshotTracking(); console.log(JSON.stringify(result, null, 2)); }
          else if (tool === 'campaign') { const profile = (await chooseProfile((q) => prompt(q))) || 'balanced'; console.log(JSON.stringify(await context.bot.runCampaign({ loops: 1, strategyProfile: profile, intervalSeconds: 0 }), null, 2)); }
          else if (tool === 'faucet-loop') { const result = await runFaucetLoop(context.bot, { durationHours: 24, intervalMinutes: 60 }); console.log(JSON.stringify(result, null, 2)); }
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
