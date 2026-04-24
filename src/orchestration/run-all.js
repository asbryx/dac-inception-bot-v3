const { accountNames } = require('../config/accounts');
const { validateSelectedAccounts } = require('../config/preflight');
const { runAcrossAccounts } = require('./runner');
const { classifyFailure, loadResumeReport, successfulAccounts, writeRunReport } = require('./reporting');

async function runAutomationAll({ contextFactory, selected = null, options = {}, onStart = null, onComplete = null, onProgress = null, concurrency = 1, prepareContext = null, timeoutMs = 0, resumeFrom = null, reportFile = null, writeReport = false, proxyRotation = null } = {}) {
  const requestedAccounts = selected && selected.length ? selected : accountNames();
  const resumeReport = resumeFrom ? loadResumeReport(resumeFrom) : null;
  const completed = successfulAccounts(resumeReport);
  const accounts = requestedAccounts.filter((account) => !completed.has(account));
  const skippedResults = requestedAccounts
    .filter((account) => completed.has(account))
    .map((account) => ({ account, ok: true, skipped: true, reason: 'resume-completed' }));
  const preflight = validateSelectedAccounts(accounts);
  const validAccounts = preflight.rows.filter((row) => row.ok).map((row) => row.accountName);
  const invalidResults = preflight.invalid.map((row) => {
    const error = `${row.accountName} | preflight | config | ${row.issues.join('; ')}`;
    return {
      account: row.accountName,
      ok: false,
      error,
      failureType: classifyFailure(error),
      durationMs: 0,
    };
  });
  const results = await runAcrossAccounts(validAccounts, async (accountName) => {
    const context = await contextFactory(accountName);
    if (prepareContext) prepareContext(accountName, context);
    return context.services.automation.run(options, (event) => onProgress && onProgress({ account: accountName, ...event }));
  }, { onStart, onComplete, concurrency, action: 'run-all', timeoutMs });
  const allResults = [...skippedResults, ...invalidResults, ...results];
  const report = {
    task: 'run-all',
    accounts: requestedAccounts,
    skippedAccounts: skippedResults.map((row) => row.account),
    preflight,
    results: allResults,
    proxy: proxyRotation?.snapshot ? proxyRotation.snapshot() : null,
    totals: {
      ok: allResults.filter((row) => row.ok).length,
      failed: allResults.filter((row) => !row.ok).length,
      skipped: allResults.filter((row) => row.skipped).length,
      durationMs: allResults.reduce((sum, row) => sum + (row.durationMs || 0), 0),
    },
    updatedAt: new Date().toISOString(),
  };
  if (writeReport || reportFile) report.reportFile = writeRunReport(report, reportFile);
  return report;
}

module.exports = { runAutomationAll };
