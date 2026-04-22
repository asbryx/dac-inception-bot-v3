const { renderHeader, renderSystemCheck, renderSummary } = require('./panels');
const { summarizeAccounts } = require('../domain/summary');
const { color, ANSI, theme } = require('./theme');

async function runLauncher(context, promptFn) {
  const header = renderHeader(context.accountName);
  const sysCheck = renderSystemCheck([
    `${color('Warming snapshot in background', ANSI.warmGray)}`,
    `${color('Session initialized', ANSI.warmGray)}`,
  ]);
  console.log(`\n${header}\n${sysCheck}\n`);
  return require('./menus').chooseLauncherMode(promptFn);
}

function renderSummaryScreen(results) {
  const rows = results.results.map((row) => row.ok ? row.result : { accountName: row.account, error: row.error, taskSummary: {} });
  return renderSummary(summarizeAccounts(rows));
}

module.exports = { runLauncher, renderSummaryScreen };
