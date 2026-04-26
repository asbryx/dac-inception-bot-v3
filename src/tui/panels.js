const { box, heroBox, colorProgressBar, metric, pill } = require('./renderer');
const { color, ANSI, C, theme, colorBanner } = require('./theme');
const { table, shortAddress, shortHash, shortUrl, shortenError } = require('../utils/format');

const S = theme.symbols;

// ─── Helpers ────────────────────────────────────────────

function toneStatus(status) {
  if (status === 'ok')    return color(`${S.ok} OK`,    C.success);
  if (status === 'error') return color(`${S.fail} ERR`,  C.error);
  if (status === 'stale') return color(`${S.stale} STALE`, C.warn);
  return status;
}

function displayValue(value) {
  return value == null || value === '' ? color('—', C.muted) : value;
}

function chunkRows(rows, size = 14) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ─── Summary stats (inline) ────────────────────────────

function statLine(summary) {
  return [
    pill(`${S.bullet} ${summary.totalAccounts} accounts`, C.value),
    pill(`${S.ok} ${summary.okCount} ok`, C.success),
    summary.failedCount
      ? pill(`${S.fail} ${summary.failedCount} failed`, C.error)
      : pill(`${S.ok} 0 failed`, C.muted),
    pill(`${S.diamond} ${summary.totalQe} QE`, C.primary),
    pill(`${S.tri} ${displayValue(summary.totalDacc)} DACC`, C.success),
    pill(`${S.star} ${summary.totalBadges} badges`, C.warn),
  ].join('   ');
}

// ─── Account rows table ────────────────────────────────

function renderRowsTable(rows) {
  return table(
    ['Account', 'Rank', 'QE', 'DACC', 'Badges', 'Tasks', 'Streak', 'Refs', 'Status'],
    rows.map((r) => [
      color(r.accountName || r.account, C.value),
      displayValue(r.rank),
      displayValue(r.qe),
      displayValue(r.dacc),
      `${displayValue(r.badges)}/${displayValue(r.badgeTotal)}`,
      `${displayValue(r.taskSummary?.done)}/${displayValue(r.taskSummary?.total)}`,
      displayValue(r.streak),
      displayValue(r.referralCount),
      toneStatus(r.error ? 'error' : r.stale ? 'stale' : 'ok'),
    ]),
  );
}

// ═══════════════════════════════════════════════════════
//  PANELS — each function returns a formatted string
// ═══════════════════════════════════════════════════════

// ── Header ──────────────────────────────────────────────

function renderHeader(accountName) {
  const banner = colorBanner();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return [
    banner,
    heroBox(`${S.diamond} DAC Inception Bot v3`, [
      metric('Account', accountName || '?', { tone: C.primary }),
      metric('Time', now, { tone: C.muted }),
    ], 58),
  ].join('\n');
}

// ── System Check ────────────────────────────────────────

function renderSystemCheck(lines) {
  return box(`${S.ok} System Check`, lines.map((l) =>
    `  ${color(S.tri, C.success)} ${color(l, C.label)}`
  ), 58);
}

// ── Progress ────────────────────────────────────────────

function renderProgress(lines) {
  return box(`${S.tri} Progress`, lines.map((l) =>
    `  ${color(S.arrow, C.primary)} ${l}`
  ), 72);
}

// ── Summary (main dashboard) ────────────────────────────

function renderSummary(summary) {
  const chunks = chunkRows(summary.rows, 12);
  const lines = ['', statLine(summary)];
  chunks.forEach((chunk, i) => {
    lines.push('', color(`  Page ${i + 1}/${chunks.length}`, C.muted), '', renderRowsTable(chunk));
  });
  lines.push('');
  return box(`${S.star} Summary`, lines, 144);
}

// ── Top Accounts ────────────────────────────────────────

function renderTopAccountsPanel(summary) {
  if (!summary.topAccounts?.length) return '';
  const lines = ['', ...summary.topAccounts.map((r, i) => {
    const num = color(`${i + 1}.`, C.muted);
    const name = color(r.accountName || r.account, C.value);
    const qe = `${color('QE', C.label)} ${color(String(displayValue(r.qe)), C.primary)}`;
    const rank = `${color('Rank', C.label)} ${color(String(displayValue(r.rank)), C.warn)}`;
    const dacc = `${color('DACC', C.label)} ${color(String(displayValue(r.dacc)), C.success)}`;
    const badges = `${color('Badges', C.label)} ${color(`${displayValue(r.badges)}/${displayValue(r.badgeTotal)}`, C.accent)}`;
    return `  ${num} ${name}  ${qe}  ${rank}  ${dacc}  ${badges}`;
  }), ''];
  return box(`${S.star} Top Accounts`, lines, 116);
}

// ── Aggregate Overview ──────────────────────────────────

function renderAggregatePanel(summary) {
  const stale = summary.rows.filter((r) => r.stale).length;
  const fail = summary.failedRows?.length || 0;
  return box(`${S.diamond} Overview`, [
    '',
    statLine(summary),
    '',
    metric('Stale', stale, { tone: stale ? C.warn : C.muted }),
    metric('Failed', fail, { tone: fail ? C.error : C.muted }),
    '',
  ], 100);
}

// ── Summary Bundle ──────────────────────────────────────

function renderSummaryBundle(summary) {
  return [
    renderAggregatePanel(summary),
    renderTopAccountsPanel(summary),
    renderSummary(summary),
    renderFailuresPanel(summary.failedRows || []),
  ].filter(Boolean).join('\n');
}

// ── Failures ────────────────────────────────────────────

function renderFailuresPanel(failedRows = []) {
  if (!failedRows.length) return '';
  return box(`${S.fail} Failures (${failedRows.length})`, [
    '',
    ...failedRows.map((r) =>
      `  ${color(S.fail, C.error)} ${color(r.accountName || r.account, C.value)} ${color(S.arrow, C.muted)} ${color(shortenError(r.error), C.errorText)}`
    ),
    '',
  ], 132);
}

// ── Multi-Result ────────────────────────────────────────

function renderMultiResultPanel(title, orchestration = {}) {
  const rows = Array.isArray(orchestration.results) ? orchestration.results : [];
  const ok = rows.filter((r) => r.ok);
  const fail = rows.filter((r) => !r.ok);
  return [
    box(`${S.diamond} ${title}`, [
      '',
      `  ${pill(`${rows.length} accounts`, C.label)}   ${pill(`${S.ok} ${ok.length} ok`, C.success)}   ${pill(`${S.fail} ${fail.length} failed`, fail.length ? C.error : C.muted)}`,
      '',
      table(['Account', 'Status'], rows.map((r) => [
        color(r.account, C.value),
        r.ok ? color(`${S.ok} OK`, C.success) : color(`${S.fail} ERR`, C.error),
      ])),
      '',
    ], 100),
    renderFailuresPanel(fail),
  ].filter(Boolean).join('\n');
}

// ── Status (single account) ─────────────────────────────

function renderStatusPanel(status) {
  const qeBar = colorProgressBar(status.qe ?? 0, 10000, 20);
  const td = status.taskSummary?.done ?? 0;
  const tt = status.taskSummary?.total ?? 1;
  const taskBar = colorProgressBar(td, tt, 12);
  return heroBox(`${S.diamond} Account Status`, [
    '',
    metric('Account', displayValue(status.accountName), { tone: C.primary }),
    metric('Wallet', status.wallet ? shortAddress(status.wallet) : '?', { tone: C.label }),
    '',
    color('  ── Performance ─────────────────────', C.muted),
    '',
    `${metric('QE', displayValue(status.qe), { tone: C.primary })}   ${qeBar}`,
    `${metric('Rank', displayValue(status.rank), { tone: C.warn })}   ${metric('DACC', displayValue(status.dacc), { labelWidth: 5, tone: C.success })}`,
    `${metric('Badges', `${displayValue(status.badges)}/${displayValue(status.badgeTotal)}`, { tone: C.accent })}   ${metric('Tasks', `${td}/${tt}`, { labelWidth: 6, tone: C.success })} ${taskBar}`,
    `${metric('Streak', displayValue(status.streak), { tone: C.warn })}   ${metric('Referrals', displayValue(status.referralCount), { labelWidth: 10, tone: C.accent })}`,
    metric('Faucet', displayValue(status.faucetAvailable), { tone: status.faucetAvailable ? C.success : C.warn }),
    '',
    color('  ── Network ─────────────────────────', C.muted),
    '',
    `${metric('Block', displayValue(status.network?.blockNumber), { tone: C.label })}   ${metric('TPS', displayValue(status.network?.tps), { labelWidth: 4, tone: C.primary })}   ${metric('BT', displayValue(status.network?.blockTime), { labelWidth: 3, tone: C.label })}`,
    '',
    status.errors?.length
      ? `  ${color(S.fail, C.error)} ${color('Errors:', C.error)} ${status.errors.map((e) => color(shortenError(e), C.errorText)).join(` ${color('|', C.muted)} `)}`
      : `  ${color(S.ok, C.success)} ${color('No errors', C.muted)}`,
    '',
  ], 96);
}

// ── Action Result ───────────────────────────────────────

function renderActionResult(title, lines) {
  return box(`${S.tri} ${title}`, lines.map((l) =>
    `  ${color(S.tri, C.primary)} ${l}`
  ), 96);
}

// ── Transaction ─────────────────────────────────────────

function renderTxPanel(title, payload = {}, { amount = null, rankKey = null } = {}) {
  const lines = [''];
  if (amount != null) lines.push(metric('Amount', amount, { tone: C.success }));
  if (rankKey)        lines.push(metric('Rank', rankKey, { tone: C.warn }));
  if (payload.status) lines.push(metric('Status', payload.status, { tone: payload.status === 'pending' ? C.warn : C.success }));
  lines.push(
    metric('Tx', shortHash(payload.hash || payload.txHash || ''), { tone: C.primary }),
    metric('Explorer', shortUrl(payload.explorer || ''), { tone: C.muted }),
    '',
  );
  return box(`${S.arrow} ${title}`, lines, 96);
}

// ── Loop ────────────────────────────────────────────────

function renderLoopPanel(title, payload = {}) {
  return box(`${S.circle} ${title}`, [
    '',
    metric('Account', displayValue(payload.account), { tone: C.primary }),
    metric('Duration', `${displayValue(payload.durationHours)}h`, { tone: C.value }),
    metric('Interval', `${displayValue(payload.intervalMinutes)}m`, { tone: C.value }),
    metric('Runs', Array.isArray(payload.runs) ? payload.runs.length : 0, { tone: C.success }),
    '',
  ], 96);
}

// ── Proxy Pool ──────────────────────────────────────────

function renderProxyPanel(proxyState = {}) {
  if (!proxyState || !proxyState.total) return '';
  const stats = [
    '',
    `  ${pill(`${displayValue(proxyState.total)} total`, C.value)}   ${pill(`${displayValue(proxyState.active)} active`, C.success)}   ${pill(`${displayValue(proxyState.healthy)} healthy`, C.success)}   ${pill(`${displayValue(proxyState.cooldown)} cooldown`, C.warn)}   ${pill(`${displayValue(proxyState.unused)} unused`, C.muted)}`,
    '',
  ];
  const aRows = Array.isArray(proxyState.assignments)
    ? proxyState.assignments.map((a) => [color(a.key, C.value), color(a.label || a.proxyUrl, C.label), color(a.source, C.muted)])
    : [];
  const pRows = Array.isArray(proxyState.rows)
    ? proxyState.rows.map((r) => [
        color(r.label || r.url, C.label),
        toneStatus(r.status === 'ok' || r.status === 'healthy' ? 'ok' : r.status === 'error' ? 'error' : r.status),
        r.assignedTo.length ? color(r.assignedTo.join(', '), C.value) : color('—', C.muted),
        r.lastError ? color(shortenError(r.lastError), C.errorText) : color('—', C.muted),
      ])
    : [];
  const fLines = Array.isArray(proxyState.failovers) && proxyState.failovers.length
    ? proxyState.failovers.map((e) =>
        `  ${color(e.key, C.primary)} ${color(S.arrow, C.muted)} ${color(shortUrl(e.from || '—'), C.label)} ${color(S.arrow, C.warn)} ${color(shortUrl(e.to || '—'), C.success)}`
      )
    : [`  ${color('None', C.muted)}`];

  const dash = (h, r) => r.length ? table(h, r) : `  ${color('—', C.muted)}`;
  return [
    box(`${S.diamond} Proxy Pool`, stats, 132),
    box(`${S.arrow} Wallet ${S.arrow} Proxy`, [dash(['Wallet', 'Proxy', 'Source'], aRows)], 132),
    box(`${S.bullet} Proxy Status`, [dash(['Proxy', 'Status', 'Wallets', 'Last Error'], pRows)], 132),
    box(`${S.circle} Failovers`, fLines, 132),
  ].filter(Boolean).join('\n');
}

// ── Tracking ────────────────────────────────────────────

function renderTrackingPanel(payload = {}) {
  return box(`${S.star} Tracking`, [
    '',
    metric('Account', displayValue(payload.accountName || payload.account), { tone: C.primary }),
    `${metric('QE', displayValue(payload.qe), { tone: C.primary })}   ${colorProgressBar(payload.qe ?? 0, 10000, 16)}`,
    metric('Rank', displayValue(payload.rank), { tone: C.warn }),
    metric('Badges', `${displayValue(payload.badges)}/${displayValue(payload.badgeTotal)}`, { tone: C.accent }),
    '',
  ], 96);
}

// ── Campaign ────────────────────────────────────────────

function renderCampaignPanel(payload = {}) {
  return box(`${S.star} Campaign`, [
    '',
    metric('Loops', displayValue(payload.loops), { tone: C.primary }),
    metric('Runs', Array.isArray(payload.results) ? payload.results.length : 0, { tone: C.success }),
    '',
  ], 96);
}

// ── Mint All ────────────────────────────────────────────

function renderMintAllPanel(payload = {}) {
  return box(`${S.star} Mint All Ranks`, [
    '',
    metric('Updated', displayValue(payload.updatedAt), { tone: C.muted }),
    metric('Keys', Object.keys(payload || {}).join(', ') || '?', { tone: C.value }),
    '',
  ], 96);
}

// ── Wallet Login ────────────────────────────────────────

function renderWalletLoginPanel(payload = {}) {
  return box(`${S.ok} Wallet Login`, [
    '',
    metric('Wallet', payload.wallet ? shortAddress(payload.wallet) : '?', { tone: C.primary }),
    metric('Status', payload.ok
      ? color(`${S.ok} Authenticated`, C.success)
      : color(`${S.fail} Error`, C.error)),
    '',
  ], 96);
}

// ── Receive ─────────────────────────────────────────────

function renderReceivePanel(payload = {}, fallback = {}) {
  return box(`${S.arrow} Receive Quest`, [
    '',
    metric('Count', displayValue(payload.count ?? fallback.count), { tone: C.value }),
    metric('Amount', displayValue(payload.amount ?? fallback.amount), { tone: C.success }),
    metric('Status', color('Complete', C.success)),
    '',
  ], 96);
}

// ── Mesh ────────────────────────────────────────────────

function renderMeshPanel(payload = {}, fallback = {}) {
  return box(`${S.arrow} TX Mesh`, [
    '',
    metric('Count', displayValue(payload.count ?? fallback.count), { tone: C.value }),
    metric('Amount', displayValue(payload.amount ?? fallback.amount), { tone: C.success }),
    metric('Status', color('Complete', C.success)),
    '',
  ], 96);
}

// ── Mint Rank ───────────────────────────────────────────

function renderMintRankPanel(payload = {}, rankKey = null) {
  return renderTxPanel(`${S.star} Mint Rank`, payload, { rankKey: payload.rankKey || rankKey });
}

// ── Mint Scan ───────────────────────────────────────────

function renderMintScan(rows = []) {
  const tRows = rows.map((r) => [
    color(r.rankName || r.badgeKey, C.value),
    r.badgeOwned   ? color(`${S.ok} Badge`,   C.success)  : color('—', C.muted),
    r.eligibleByQe ? color(`${S.ok} QE`,      C.success)  : color('—', C.muted),
    r.backendReady ? color(`${S.ok} Ready`,    C.success)  : r.degraded ? color(`${S.stale} Degraded`, C.warn) : color('Locked', C.muted),
    r.minted       ? color(`${S.ok} Minted`,   C.primary)  : color('Open', C.label),
  ]);
  return box(`${S.diamond} Mint Scan`, [
    '',
    table(['Rank', 'Badge', 'QE', 'Backend', 'Chain'], tRows),
    '',
  ], 88);
}

module.exports = {
  renderHeader, renderSystemCheck, renderProgress,
  renderSummary, renderSummaryBundle, renderFailuresPanel,
  renderMultiResultPanel, renderStatusPanel, renderActionResult,
  renderTxPanel, renderLoopPanel, renderProxyPanel,
  renderTrackingPanel, renderCampaignPanel, renderMintAllPanel,
  renderWalletLoginPanel, renderReceivePanel, renderMeshPanel,
  renderMintRankPanel, renderMintScan, displayValue,
};
