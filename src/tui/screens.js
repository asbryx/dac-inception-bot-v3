const { renderHeader, renderSystemCheck, renderSummary } = require('./panels');
const { summarizeAccounts } = require('../domain/summary');

async function runLauncher(context, promptFn) {
  const lines = [renderHeader(context.accountName), renderSystemCheck(['warming snapshot in background'])];
  lines.forEach((line) => console.log(line));
  return require('./menus').chooseLauncherMode(promptFn);
}

function renderSummaryScreen(results) {
  const rows = results.results.map((row) => row.ok ? row.result : { accountName: row.account, error: row.error, taskSummary: {} });
  return renderSummary(summarizeAccounts(rows));
}

module.exports = { runLauncher, renderSummaryScreen };
