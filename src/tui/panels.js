const { box, colorProgressBar, metric, pill } = require('./renderer');
const { color, ANSI, theme } = require('./theme');
const { table, shortAddress, shortHash, shortUrl, shortenError } = require('../utils/format');

function toneStatus(status) {
  if (status === 'ok') return color(`${theme.symbols.ok} ok`, ANSI.brightGreen);
  if (status === 'error') return color(`${theme.symbols.fail} error`, ANSI.red);
  if (status === 'stale') return color(`${theme.symbols.stale} stale`, ANSI.yellow);
  return status;
}

function chunkRows(rows, size = 14) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function renderRowsTable(rows) {
  return table(['Account', 'Rank', 'QE', 'Badges', 'Tasks', 'Streak', 'Refs', 'Status'], rows.map((row) => [
    row.accountName || row.account,
    displayValue(row.rank),
    displayValue(row.qe),
    `${displayValue(row.badges)}/${displayValue(row.badgeTotal)}`,
    `${displayValue(row.taskSummary?.done)}/${displayValue(row.taskSummary?.total)}`,
    displayValue(row.streak),
    displayValue(row.referralCount),
    toneStatus(row.error ? 'error' : (row.stale ? 'stale' : 'ok')),
  ]));
}

function aggregateLine(summary) {
  return [
    pill(`accounts ${summary.totalAccounts}`, ANSI.brightWhite),
    pill(`ok ${summary.okCount}`, ANSI.brightGreen),
    summary.failedCount ? pill(`failed ${summary.failedCount}`, ANSI.red) : pill(`failed ${summary.failedCount}`, ANSI.dim),
    pill(`QE ${summary.totalQe}`, ANSI.brightCyan),
    pill(`badges ${summary.totalBadges}`, ANSI.yellow),
  ].join('  ');
}

function symbolBullet(text, tone = ANSI.white) {
  return color(`${theme.symbols.ready} ${text}`, tone);
}

function sectionLabel(text, tone = ANSI.bold) {
  return color(text, tone);
}

function statusTone(value) {
  if (value === true) return color('ready', ANSI.brightGreen);
  if (value === false) return color('cooldown', ANSI.yellow);
  return displayValue(value);
}

function colorizeShortValue(value, tone = ANSI.cyan) {
  return color(String(value), tone);
}

function displayValue(value) {
  return value == null || value === '' ? color('?', ANSI.dim) : value;
}

function renderHeader(accountName) {
  return box('DAC Inception Bot v3', [
    `${metric('Account', accountName || '?', { tone: ANSI.brightCyan })}`,
    `${metric('Time', new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'), { tone: ANSI.dim })}`,
  ], 64, { tone: ANSI.brightCyan });
}

function renderSystemCheck(lines) {
  return box(`${theme.symbols.diamond} System Check`, lines, 64, { tone: ANSI.blue });
}

function renderProgress(lines) {
  return box(`${theme.symbols.arrow} Progress`, lines, 72, { tone: ANSI.magenta });
}

function renderSummary(summary) {
  const chunks = chunkRows(summary.rows, 12);
  const lines = [aggregateLine(summary)];
  chunks.forEach((chunk, index) => {
    lines.push('', sectionLabel(`${theme.symbols.ready} Page ${index + 1}/${chunks.length || 1}`, ANSI.dim), renderRowsTable(chunk));
  });
  return box(`${theme.symbols.star} Summary`, lines, 132, { tone: ANSI.cyan });
}

function renderTopAccountsPanel(summary) {
  if (!summary.topAccounts?.length) return '';
  return box(`${theme.symbols.star} Top Accounts`, summary.topAccounts.map((row, index) =>
    `${color(`${index + 1}.`, ANSI.brightYellow)} ${color(row.accountName || row.account, ANSI.brightWhite)}  ${metric('QE', displayValue(row.qe), { labelWidth: 2, tone: ANSI.brightCyan })}  ${metric('Rank', displayValue(row.rank), { labelWidth: 4, tone: ANSI.yellow })}  ${metric('Badges', `${displayValue(row.badges)}/${displayValue(row.badgeTotal)}`, { labelWidth: 6, tone: ANSI.magenta })}`
  ), 100, { tone: ANSI.yellow });
}

function renderAggregatePanel(summary) {
  return box(`${theme.symbols.diamond} Overview`, [
    aggregateLine(summary),
    symbolBullet(`stale: ${summary.rows.filter((row) => row.stale).length}`, ANSI.yellow),
    symbolBullet(`failed: ${summary.failedRows?.length || 0}`, summary.failedRows?.length ? ANSI.red : ANSI.dim),
  ], 100, { tone: ANSI.blue });
}

function renderSummaryBundle(summary) {
  return [
    renderAggregatePanel(summary),
    renderTopAccountsPanel(summary),
    renderSummary(summary),
    renderFailuresPanel(summary.failedRows || []),
  ].filter(Boolean).join('\n');
}

function renderFailuresPanel(failedRows = []) {
  if (!failedRows.length) return '';
  return box(`${theme.symbols.fail} Failures`, failedRows.map((row) =>
    `${color(row.accountName || row.account, ANSI.red)} ${color(theme.symbols.arrow, ANSI.dim)} ${shortenError(row.error)}`
  ), 132, { tone: ANSI.red });
}

function renderMultiResultPanel(title, orchestration = {}) {
  const rows = Array.isArray(orchestration.results) ? orchestration.results : [];
  const ok = rows.filter((row) => row.ok);
  const failed = rows.filter((row) => !row.ok);
  const lines = [
    `${pill(`task ${title}`, ANSI.brightWhite)}  ${pill(`accounts ${rows.length}`, ANSI.dim)}  ${pill(`ok ${ok.length}`, ANSI.brightGreen)}  ${pill(`failed ${failed.length}`, failed.length ? ANSI.red : ANSI.dim)}`,
    '',
    table(['Account', 'Status'], rows.map((row) => [row.account, row.ok ? color(`${theme.symbols.ok} ok`, ANSI.brightGreen) : color(`${theme.symbols.fail} error`, ANSI.red)])),
  ];
  return [box(title, lines, 100, { tone: ANSI.cyan }), renderFailuresPanel(failed)].filter(Boolean).join('\n');
}

function renderStatusPanel(status) {
  const qeBar = colorProgressBar(status.qe ?? 0, 10000, 16);
  return box(`${theme.symbols.diamond} Status`, [
    `${metric('Account', displayValue(status.accountName), { tone: ANSI.brightCyan })}`,
    `${metric('Wallet', status.wallet ? shortAddress(status.wallet) : '?', { tone: ANSI.white })}`,
    '',
    `${metric('QE', displayValue(status.qe), { tone: ANSI.brightCyan })}  ${qeBar}`,
    `${metric('Rank', displayValue(status.rank), { tone: ANSI.yellow })}  ${metric('DACC', displayValue(status.dacc), { labelWidth: 4, tone: ANSI.brightGreen })}`,
    `${metric('Badges', `${displayValue(status.badges)}/${displayValue(status.badgeTotal)}`, { tone: ANSI.magenta })}  ${metric('Tasks', `${displayValue(status.taskSummary?.done)}/${displayValue(status.taskSummary?.total)}`, { labelWidth: 5, tone: ANSI.green })}`,
    `${metric('Streak', displayValue(status.streak), { tone: ANSI.yellow })}  ${metric('Referrals', displayValue(status.referralCount), { labelWidth: 9, tone: ANSI.brightMagenta })}`,
    `${metric('Faucet', displayValue(status.faucetAvailable), { tone: status.faucetAvailable ? ANSI.brightGreen : ANSI.yellow })}`,
    '',
    `${metric('Chain', `blk ${displayValue(status.network?.blockNumber)} ${color('|', ANSI.dim)} tps ${displayValue(status.network?.tps)} ${color('|', ANSI.dim)} bt ${displayValue(status.network?.blockTime)}`, { tone: ANSI.dim })}`,
    status.errors?.length ? `${color(`${theme.symbols.fail} Errors:`, ANSI.red)} ${status.errors.map((item) => shortenError(item)).join(` ${color('|', ANSI.dim)} `)}` : `${color(`${theme.symbols.ok} No errors`, ANSI.dim)}`,
  ], 100, { tone: ANSI.blue });
}

function renderActionResult(title, lines) {
  return box(`${theme.symbols.ready} ${title}`, lines, 96, { tone: ANSI.cyan });
}

function renderTxPanel(title, payload = {}, { amount = null, rankKey = null } = {}) {
  return box(`${theme.symbols.arrow} ${title}`, [
    amount != null ? `${metric('Amount', amount, { tone: ANSI.brightGreen })}` : null,
    rankKey ? `${metric('Rank', rankKey, { tone: ANSI.yellow })}` : null,
    `${metric('Tx', shortHash(payload.hash || payload.txHash || ''), { tone: ANSI.brightCyan })}`,
    `${metric('Explorer', shortUrl(payload.explorer || ''), { tone: ANSI.dim })}`,
  ].filter(Boolean), 96, { tone: ANSI.green });
}

function renderLoopPanel(title, payload = {}) {
  return box(`${theme.symbols.circle} ${title}`, [
    `${metric('Account', displayValue(payload.account), { tone: ANSI.brightCyan })}`,
    `${metric('Duration', `${displayValue(payload.durationHours)}h`, { tone: ANSI.white })}`,
    `${metric('Interval', `${displayValue(payload.intervalMinutes)}m`, { tone: ANSI.white })}`,
    `${metric('Runs', Array.isArray(payload.runs) ? payload.runs.length : 0, { tone: ANSI.brightGreen })}`,
  ], 96, { tone: ANSI.blue });
}

function renderProxyPanel(proxyState = {}) {
  if (!proxyState || !proxyState.total) return '';
  const summary = [
    `${pill(`total ${displayValue(proxyState.total)}`, ANSI.brightWhite)}  ${pill(`active ${displayValue(proxyState.active)}`, ANSI.brightGreen)}  ${pill(`healthy ${displayValue(proxyState.healthy)}`, ANSI.green)}  ${pill(`cooldown ${displayValue(proxyState.cooldown)}`, ANSI.yellow)}  ${pill(`unused ${displayValue(proxyState.unused)}`, ANSI.dim)}`,
  ];
  const assignmentRows = Array.isArray(proxyState.assignments)
    ? proxyState.assignments.map((item) => [item.key, item.label || item.proxyUrl, item.source])
    : [];
  const proxyRows = Array.isArray(proxyState.rows)
    ? proxyState.rows.map((row) => [row.label || row.url, row.status, row.assignedTo.length ? row.assignedTo.join(', ') : '-', row.lastError ? shortenError(row.lastError) : '-'])
    : [];
  const failoverLines = Array.isArray(proxyState.failovers) && proxyState.failovers.length
    ? proxyState.failovers.map((event) => `${color(event.key, ANSI.brightCyan)} ${color(theme.symbols.arrow, ANSI.dim)} ${shortUrl(event.from || '-')} ${color(theme.symbols.arrow, ANSI.yellow)} ${shortUrl(event.to || '-')}`)
    : [color('none', ANSI.dim)];

  return [
    box(`${theme.symbols.diamond} Proxy Pool`, summary, 132, { tone: ANSI.blue }),
    box(`${theme.symbols.arrow} Wallet ${theme.symbols.arrow} Proxy`, [table(['Wallet', 'Proxy', 'Source'], assignmentRows.length ? assignmentRows : [['-', '-', '-']])], 132, { tone: ANSI.cyan }),
    box(`${theme.symbols.bullet} Proxy Status`, [table(['Proxy', 'Status', 'Wallets', 'Last Error'], proxyRows.length ? proxyRows : [['-', '-', '-', '-']])], 132, { tone: ANSI.cyan }),
    box(`${theme.symbols.circle} Failovers`, failoverLines, 132, { tone: ANSI.yellow }),
  ].filter(Boolean).join('\n');
}

function renderTrackingPanel(payload = {}) {
  return box(`${theme.symbols.star} Tracking`, [
    `${metric('Account', displayValue(payload.accountName || payload.account), { tone: ANSI.brightCyan })}`,
    `${metric('QE', displayValue(payload.qe), { tone: ANSI.brightCyan })}  ${colorProgressBar(payload.qe ?? 0, 10000, 16)}`,
    `${metric('Rank', displayValue(payload.rank), { tone: ANSI.yellow })}`,
    `${metric('Badges', `${displayValue(payload.badges)}/${displayValue(payload.badgeTotal)}`, { tone: ANSI.magenta })}`,
  ], 96, { tone: ANSI.magenta });
}

function renderCampaignPanel(payload = {}) {
  return box(`${theme.symbols.star} Campaign`, [
    `${metric('Loops', displayValue(payload.loops), { tone: ANSI.brightCyan })}`,
    `${metric('Runs', Array.isArray(payload.results) ? payload.results.length : 0, { tone: ANSI.brightGreen })}`,
  ], 96, { tone: ANSI.magenta });
}

function renderMintAllPanel(payload = {}) {
  return box(`${theme.symbols.diamond} Mint All Ranks`, [
    `${metric('Updated', displayValue(payload.updatedAt), { tone: ANSI.dim })}`,
    `${metric('Keys', Object.keys(payload || {}).join(', ') || '?', { tone: ANSI.white })}`,
  ], 96, { tone: ANSI.green });
}

function renderWalletLoginPanel(payload = {}) {
  return box(`${theme.symbols.ok} Wallet Login`, [
    `${metric('Wallet', payload.wallet ? shortAddress(payload.wallet) : '?', { tone: ANSI.brightCyan })}`,
    `${metric('Status', payload.ok ? color(`${theme.symbols.ok} authenticated`, ANSI.brightGreen) : color(`${theme.symbols.fail} error`, ANSI.red))}`,
  ], 96, { tone: ANSI.green });
}

function renderReceivePanel(payload = {}, fallback = {}) {
  return box(`${theme.symbols.arrow} Receive Quest`, [
    `${metric('Count', displayValue(payload.count ?? fallback.count), { tone: ANSI.white })}`,
    `${metric('Amount', displayValue(payload.amount ?? fallback.amount), { tone: ANSI.brightGreen })}`,
    `${metric('Status', color('complete', ANSI.brightGreen))}`,
  ], 96, { tone: ANSI.green });
}

function renderMeshPanel(payload = {}, fallback = {}) {
  return box(`${theme.symbols.circle} TX Mesh`, [
    `${metric('Count', displayValue(payload.count ?? fallback.count), { tone: ANSI.white })}`,
    `${metric('Amount', displayValue(payload.amount ?? fallback.amount), { tone: ANSI.brightGreen })}`,
    `${metric('Status', color('complete', ANSI.brightGreen))}`,
  ], 96, { tone: ANSI.cyan });
}

function renderMintRankPanel(payload = {}, rankKey = null) {
  return renderTxPanel(`${theme.symbols.star} Mint Rank`, payload, { rankKey: payload.rankKey || rankKey });
}

function renderMintScan(rows = []) {
  const tableRows = rows.map((row) => [
    row.rankName || row.badgeKey,
    row.badgeOwned ? color(`${theme.symbols.ok} badge`, ANSI.brightGreen) : color('-', ANSI.dim),
    row.eligibleByQe ? color(`${theme.symbols.ok} qe`, ANSI.brightGreen) : color('-', ANSI.dim),
    row.backendReady ? color(`${theme.symbols.ok} ready`, ANSI.brightGreen) : (row.degraded ? color('degraded', ANSI.yellow) : color('locked', ANSI.dim)),
    row.minted ? color(`${theme.symbols.ok} minted`, ANSI.brightCyan) : color('open', ANSI.dim),
  ]);
  return box(`${theme.symbols.diamond} Mint Scan`, [
    table(['Rank', 'Badge', 'QE', 'Backend', 'Chain'], tableRows),
  ], 88, { tone: ANSI.green });
}

module.exports = {
  renderHeader,
  renderSystemCheck,
  renderProgress,
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
  displayValue,
};
