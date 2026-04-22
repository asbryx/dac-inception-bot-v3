const { renderHeader, renderSystemCheck, renderSummary } = require('./panels');
const { summarizeAccounts } = require('../domain/summary');
const { color, C } = require('./theme');

async function runLauncher(context, promptFn) {
  const header = renderHeader(context.accountName);
  const check = renderSystemCheck([
    'Warming snapshot in background',
    'Session initialized',
  ]);
  console.log(`\n${header}\n${check}\n`);
  return require('./menus').chooseLauncherMode(promptFn);
}

function renderSummaryScreen(results) {
  const rows = results.results.map((r) =>
    r.ok ? r.result : { accountName: r.account, error: r.error, taskSummary: {} },
  );
  return renderSummary(summarizeAccounts(rows));
}

module.exports = { runLauncher, renderSummaryScreen };
