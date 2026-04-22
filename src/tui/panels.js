const { box, heroBox, heavyBox, colorProgressBar, metric, pill, badge, tag, separator, sectionTitle, blankLine } = require('./renderer');
const { color, ANSI, theme, colorBanner } = require('./theme');
const { table, shortAddress, shortHash, shortUrl, shortenError } = require('../utils/format');

// ── Helpers ─────────────────────────────────────────────

function toneStatus(status) {
  if (status === 'ok') return color(`${theme.symbols.ok} OK`, ANSI.brightGreen);
  if (status === 'error') return color(`${theme.symbols.fail} ERR`, ANSI.red);
  if (status === 'stale') return color(`${theme.symbols.stale} STALE`, ANSI.brightYellow);
  return status;
}

function displayValue(value) {
  return value == null || value === '' ? color('—', ANSI.darkGray) : value;
}

function chunkRows(rows, size = 14) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function statusDot(ok) {
  return ok ? color(theme.symbols.bullet, ANSI.brightGreen) : color(theme.symbols.bullet, ANSI.red);
}

// ── Tables ──────────────────────────────────────────────

function renderRowsTable(rows) {
  return table(
    ['Account', 'Rank', 'QE', 'Badges', 'Tasks', 'Streak', 'Refs', 'Status'],
    rows.map((row) => [
      color(row.accountName || row.account, ANSI.brightWhite),
      displayValue(row.rank),
      displayValue(row.qe),
      `${displayValue(row.badges)}/${displayValue(row.badgeTotal)}`,
      `${displayValue(row.taskSummary?.done)}/${displayValue(row.taskSummary?.total)}`,
      displayValue(row.streak),
      displayValue(row.referralCount),
      toneStatus(row.error ? 'error' : (row.stale ? 'stale' : 'ok')),
    ]),
  );
}

// ── Aggregate line ──────────────────────────────────────

function aggregateLine(summary) {
  return [
    pill(`${theme.symbols.bullet} ${summary.totalAccounts} accounts`, ANSI.brightWhite),
    pill(`${theme.symbols.ok} ${summary.okCount} ok`, ANSI.brightGreen),
    summary.failedCount
      ? pill(`${theme.symbols.fail} ${summary.failedCount} failed`, ANSI.red)
      : pill(`${theme.symbols.ok} 0 failed`, ANSI.darkGray),
    pill(`${theme.symbols.bolt} ${summary.totalQe} QE`, ANSI.brightCyan),
    pill(`${theme.symbols.star} ${summary.totalBadges} badges`, ANSI.gold),
  ].join('  ');
}

// ── Header / Banner ─────────────────────────────────────

function renderHeader(accountName) {
  const banner = colorBanner();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const info = [
    metric('Account', accountName || '?', { tone: ANSI.brightCyan }),
    metric('Time', now, { tone: ANSI.slate }),
  ];
  return `${banner}\n${heroBox(`${theme.symbols.bolt} DAC Inception Bot v3`, info, 64, { tone: ANSI.brightCyan })}`;
}

// ── System check ────────────────────────────────────────

function renderSystemCheck(lines) {
  const formatted = lines.map((line) =>
    `  ${color(theme.symbols.radioOn, ANSI.teal)} ${color(line, ANSI.warmGray)}`
  );
  return box(`${theme.symbols.shield} System Check`, formatted, 64, { tone: ANSI.teal });
}

// ── Progress ────────────────────────────────────────────

function renderProgress(lines) {
  const formatted = lines.map((line) =>
    `  ${color(theme.symbols.arrowRight, ANSI.brightMagenta)} ${line}`
  );
  return box(`${theme.symbols.rocket} Progress`, formatted, 72, { tone: ANSI.brightMagenta });
}

// ── Summary ─────────────────────────────────────────────

function renderSummary(summary) {
  const chunks = chunkRows(summary.rows, 12);
  const lines = [aggregateLine(summary)];
  chunks.forEach((chunk, index) => {
    lines.push(
      blankLine(),
      `  ${color(`Page ${index + 1}/${chunks.length || 1}`, `${ANSI.dim}${ANSI.slate}`)}`,
      blankLine(),
      renderRowsTable(chunk),
    );
  });
  return heavyBox(`${theme.symbols.trophy} Summary`, lines, 132, { tone: ANSI.brightCyan });
}

// ── Top accounts ────────────────────────────────────────

function renderTopAccountsPanel(summary) {
  if (!summary.topAccounts?.length) return '';
  const lines = summary.topAccounts.map((row, index) => {
    const medal = index === 0 ? color('🥇', '') : index === 1 ? color('🥈', '') : index === 2 ? color('🥉', '') : color(`${index + 1}.`, ANSI.slate);
    const name = color(row.accountName || row.account, ANSI.brightWhite);
    const qe = tag('QE', String(displayValue(row.qe)), ANSI.brightCyan);
    const rank = tag('Rank', String(displayValue(row.rank)), ANSI.gold);
    const badges = tag('Badges', `${displayValue(row.badges)}/${displayValue(row.badgeTotal)}`, ANSI.brightMagenta);
    return `  ${medal} ${name}   ${qe}  ${rank}  ${badges}`;
  });
  return box(`${theme.symbols.trophy} Top Accounts`, lines, 100, { tone: ANSI.gold });
}

// ── Aggregate overview ──────────────────────────────────

function renderAggregatePanel(summary) {
  const staleCount = summary.rows.filter((row) => row.stale).length;
  const failedCount = summary.failedRows?.length || 0;
  return box(`${theme.symbols.diamond} Overview`, [
    blankLine(),
    aggregateLine(summary),
    blankLine(),
    metric('Stale', staleCount, { tone: staleCount ? ANSI.brightYellow : ANSI.darkGray }),
    metric('Failed', failedCount, { tone: failedCount ? ANSI.red : ANSI.darkGray }),
    blankLine(),
  ], 100, { tone: ANSI.steel });
}

// ── Summary bundle ──────────────────────────────────────

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
  const lines = failedRows.map((row) =>
    `  ${color(theme.symbols.fail, ANSI.red)} ${color(row.accountName || row.account, ANSI.brightWhite)} ${color(theme.symbols.arrow, ANSI.darkGray)} ${color(shortenError(row.error), ANSI.coral)}`
  );
  return box(`${theme.symbols.fail} Failures (${failedRows.length})`, lines, 132, { tone: ANSI.red });
}

// ── Multi-result ────────────────────────────────────────

function renderMultiResultPanel(title, orchestration = {}) {
  const rows = Array.isArray(orchestration.results) ? orchestration.results : [];
  const ok = rows.filter((row) => row.ok);
  const failed = rows.filter((row) => !row.ok);
  const lines = [
    blankLine(),
    `  ${pill(`${theme.symbols.bolt} ${title}`, ANSI.brightWhite)}  ${pill(`${rows.length} accounts`, ANSI.slate)}  ${pill(`${theme.symbols.ok} ${ok.length} ok`, ANSI.brightGreen)}  ${pill(`${theme.symbols.fail} ${failed.length} failed`, failed.length ? ANSI.red : ANSI.darkGray)}`,
    blankLine(),
    table(['Account', 'Status'], rows.map((row) => [
      color(row.account, ANSI.brightWhite),
      row.ok ? color(`${theme.symbols.ok} OK`, ANSI.brightGreen) : color(`${theme.symbols.fail} ERR`, ANSI.red),
    ])),
    blankLine(),
  ];
  return [box(`${theme.symbols.bolt} ${title}`, lines, 100, { tone: ANSI.brightCyan }), renderFailuresPanel(failed)].filter(Boolean).join('\n');
}

// ── Status ──────────────────────────────────────────────

function renderStatusPanel(status) {
  const qeBar = colorProgressBar(status.qe ?? 0, 10000, 20);
  const tasksDone = status.taskSummary?.done ?? 0;
  const tasksTotal = status.taskSummary?.total ?? 1;
  const taskBar = colorProgressBar(tasksDone, tasksTotal, 12);
  return heroBox(`${theme.symbols.diamond} Account Status`, [
    blankLine(),
    metric('Account', displayValue(status.accountName), { tone: ANSI.brightCyan }),
    metric('Wallet', status.wallet ? shortAddress(status.wallet) : '?', { tone: ANSI.warmGray }),
    blankLine(),
    `  ${color('── Performance ──', ANSI.darkGray)}`,
    blankLine(),
    `${metric('QE', displayValue(status.qe), { tone: ANSI.brightCyan })}    ${qeBar}`,
    `${metric('Rank', displayValue(status.rank), { tone: ANSI.gold })}    ${metric('DACC', displayValue(status.dacc), { labelWidth: 4, tone: ANSI.brightGreen })}`,
    `${metric('Badges', `${displayValue(status.badges)}/${displayValue(status.badgeTotal)}`, { tone: ANSI.brightMagenta })}    ${metric('Tasks', `${tasksDone}/${tasksTotal}`, { labelWidth: 5, tone: ANSI.green })} ${taskBar}`,
    `${metric('Streak', displayValue(status.streak), { tone: ANSI.orange })}    ${metric('Referrals', displayValue(status.referralCount), { labelWidth: 9, tone: ANSI.lavender })}`,
    `${metric('Faucet', displayValue(status.faucetAvailable), { tone: status.faucetAvailable ? ANSI.brightGreen : ANSI.brightYellow })}`,
    blankLine(),
    `  ${color('── Network ──', ANSI.darkGray)}`,
    blankLine(),
    `${metric('Block', displayValue(status.network?.blockNumber), { tone: ANSI.slate })}    ${metric('TPS', displayValue(status.network?.tps), { labelWidth: 3, tone: ANSI.teal })}    ${metric('BT', displayValue(status.network?.blockTime), { labelWidth: 2, tone: ANSI.slate })}`,
    blankLine(),
    status.errors?.length
      ? `  ${color(theme.symbols.fail, ANSI.red)} ${color('Errors:', ANSI.red)} ${status.errors.map((item) => color(shortenError(item), ANSI.coral)).join(` ${color('|', ANSI.darkGray)} `)}`
      : `  ${color(theme.symbols.ok, ANSI.brightGreen)} ${color('No errors', ANSI.slate)}`,
    blankLine(),
  ], 100, { tone: ANSI.brightCyan });
}

// ── Action result ───────────────────────────────────────

function renderActionResult(title, lines) {
  const formatted = lines.map((line) =>
    `  ${color(theme.symbols.arrowRight, ANSI.teal)} ${line}`
  );
  return box(`${theme.symbols.ready} ${title}`, formatted, 96, { tone: ANSI.teal });
}

// ── Transaction panel ───────────────────────────────────

function renderTxPanel(title, payload = {}, { amount = null, rankKey = null } = {}) {
  return box(`${theme.symbols.chain} ${title}`, [
    blankLine(),
    amount != null ? metric('Amount', amount, { tone: ANSI.brightGreen }) : null,
    rankKey ? metric('Rank', rankKey, { tone: ANSI.gold }) : null,
    metric('Tx', shortHash(payload.hash || payload.txHash || ''), { tone: ANSI.brightCyan }),
    metric('Explorer', shortUrl(payload.explorer || ''), { tone: ANSI.slate }),
    blankLine(),
  ].filter(Boolean), 96, { tone: ANSI.mint });
}

// ── Loop panel ──────────────────────────────────────────

function renderLoopPanel(title, payload = {}) {
  return box(`${theme.symbols.circle} ${title}`, [
    blankLine(),
    metric('Account', displayValue(payload.account), { tone: ANSI.brightCyan }),
    metric('Duration', `${displayValue(payload.durationHours)}h`, { tone: ANSI.warmGray }),
    metric('Interval', `${displayValue(payload.intervalMinutes)}m`, { tone: ANSI.warmGray }),
    metric('Runs', Array.isArray(payload.runs) ? payload.runs.length : 0, { tone: ANSI.brightGreen }),
    blankLine(),
  ], 96, { tone: ANSI.steel });
}

// ── Proxy panel ─────────────────────────────────────────

function renderProxyPanel(proxyState = {}) {
  if (!proxyState || !proxyState.total) return '';
  const summary = [
    blankLine(),
    `  ${pill(`${theme.symbols.bullet} ${displayValue(proxyState.total)} total`, ANSI.brightWhite)}  ${pill(`${theme.symbols.ok} ${displayValue(proxyState.active)} active`, ANSI.brightGreen)}  ${pill(`${theme.symbols.ok} ${displayValue(proxyState.healthy)} healthy`, ANSI.mint)}  ${pill(`${theme.symbols.stale} ${displayValue(proxyState.cooldown)} cooldown`, ANSI.brightYellow)}  ${pill(`${theme.symbols.circle} ${displayValue(proxyState.unused)} unused`, ANSI.darkGray)}`,
    blankLine(),
  ];
  const assignmentRows = Array.isArray(proxyState.assignments)
    ? proxyState.assignments.map((item) => [
        color(item.key, ANSI.brightWhite),
        color(item.label || item.proxyUrl, ANSI.warmGray),
        color(item.source, ANSI.slate),
      ])
    : [];
  const proxyRows = Array.isArray(proxyState.rows)
    ? proxyState.rows.map((row) => [
        color(row.label || row.url, ANSI.warmGray),
        toneStatus(row.status === 'ok' ? 'ok' : row.status === 'error' ? 'error' : row.status),
        row.assignedTo.length ? color(row.assignedTo.join(', '), ANSI.brightWhite) : color('—', ANSI.darkGray),
        row.lastError ? color(shortenError(row.lastError), ANSI.coral) : color('—', ANSI.darkGray),
      ])
    : [];
  const failoverLines = Array.isArray(proxyState.failovers) && proxyState.failovers.length
    ? proxyState.failovers.map((event) =>
        `  ${color(event.key, ANSI.brightCyan)} ${color(theme.symbols.arrow, ANSI.darkGray)} ${color(shortUrl(event.from || '—'), ANSI.warmGray)} ${color(theme.symbols.arrow, ANSI.brightYellow)} ${color(shortUrl(event.to || '—'), ANSI.brightGreen)}`
      )
    : [color('  None', ANSI.darkGray)];

  return [
    heavyBox(`${theme.symbols.shield} Proxy Pool`, summary, 132, { tone: ANSI.steel }),
    box(`${theme.symbols.arrow} Wallet → Proxy`, [table(['Wallet', 'Proxy', 'Source'], assignmentRows.length ? assignmentRows : [[color('—', ANSI.darkGray), color('—', ANSI.darkGray), color('—', ANSI.darkGray)]])], 132, { tone: ANSI.teal }),
    box(`${theme.symbols.bullet} Proxy Status`, [table(['Proxy', 'Status', 'Wallets', 'Last Error'], proxyRows.length ? proxyRows : [[color('—', ANSI.darkGray), color('—', ANSI.darkGray), color('—', ANSI.darkGray), color('—', ANSI.darkGray)]])], 132, { tone: ANSI.teal }),
    box(`${theme.symbols.circle} Failovers`, failoverLines, 132, { tone: ANSI.brightYellow }),
  ].filter(Boolean).join('\n');
}

// ── Tracking panel ──────────────────────────────────────

function renderTrackingPanel(payload = {}) {
  return box(`${theme.symbols.fire} Tracking`, [
    blankLine(),
    metric('Account', displayValue(payload.accountName || payload.account), { tone: ANSI.brightCyan }),
    `${metric('QE', displayValue(payload.qe), { tone: ANSI.brightCyan })}    ${colorProgressBar(payload.qe ?? 0, 10000, 16)}`,
    metric('Rank', displayValue(payload.rank), { tone: ANSI.gold }),
    metric('Badges', `${displayValue(payload.badges)}/${displayValue(payload.badgeTotal)}`, { tone: ANSI.brightMagenta }),
    blankLine(),
  ], 96, { tone: ANSI.deepPurple });
}

// ── Campaign panel ──────────────────────────────────────

function renderCampaignPanel(payload = {}) {
  return box(`${theme.symbols.rocket} Campaign`, [
    blankLine(),
    metric('Loops', displayValue(payload.loops), { tone: ANSI.brightCyan }),
    metric('Runs', Array.isArray(payload.results) ? payload.results.length : 0, { tone: ANSI.brightGreen }),
    blankLine(),
  ], 96, { tone: ANSI.deepPurple });
}

// ── Mint all panel ──────────────────────────────────────

function renderMintAllPanel(payload = {}) {
  return box(`${theme.symbols.star} Mint All Ranks`, [
    blankLine(),
    metric('Updated', displayValue(payload.updatedAt), { tone: ANSI.slate }),
    metric('Keys', Object.keys(payload || {}).join(', ') || '?', { tone: ANSI.warmGray }),
    blankLine(),
  ], 96, { tone: ANSI.mint });
}

// ── Wallet login panel ──────────────────────────────────

function renderWalletLoginPanel(payload = {}) {
  return box(`${theme.symbols.ok} Wallet Login`, [
    blankLine(),
    metric('Wallet', payload.wallet ? shortAddress(payload.wallet) : '?', { tone: ANSI.brightCyan }),
    metric('Status', payload.ok
      ? color(`${theme.symbols.ok} Authenticated`, ANSI.brightGreen)
      : color(`${theme.symbols.fail} Error`, ANSI.red)),
    blankLine(),
  ], 96, { tone: ANSI.mint });
}

// ── Receive panel ───────────────────────────────────────

function renderReceivePanel(payload = {}, fallback = {}) {
  return box(`${theme.symbols.arrow} Receive Quest`, [
    blankLine(),
    metric('Count', displayValue(payload.count ?? fallback.count), { tone: ANSI.warmGray }),
    metric('Amount', displayValue(payload.amount ?? fallback.amount), { tone: ANSI.brightGreen }),
    metric('Status', color('Complete', ANSI.brightGreen)),
    blankLine(),
  ], 96, { tone: ANSI.mint });
}

// ── Mesh panel ──────────────────────────────────────────

function renderMeshPanel(payload = {}, fallback = {}) {
  return box(`${theme.symbols.chain} TX Mesh`, [
    blankLine(),
    metric('Count', displayValue(payload.count ?? fallback.count), { tone: ANSI.warmGray }),
    metric('Amount', displayValue(payload.amount ?? fallback.amount), { tone: ANSI.brightGreen }),
    metric('Status', color('Complete', ANSI.brightGreen)),
    blankLine(),
  ], 96, { tone: ANSI.teal });
}

// ── Mint rank panel ─────────────────────────────────────

function renderMintRankPanel(payload = {}, rankKey = null) {
  return renderTxPanel(`${theme.symbols.star} Mint Rank`, payload, { rankKey: payload.rankKey || rankKey });
}

// ── Mint scan ───────────────────────────────────────────

function renderMintScan(rows = []) {
  const tableRows = rows.map((row) => [
    color(row.rankName || row.badgeKey, ANSI.brightWhite),
    row.badgeOwned ? color(`${theme.symbols.ok} Badge`, ANSI.brightGreen) : color('—', ANSI.darkGray),
    row.eligibleByQe ? color(`${theme.symbols.ok} QE`, ANSI.brightGreen) : color('—', ANSI.darkGray),
    row.backendReady
      ? color(`${theme.symbols.ok} Ready`, ANSI.brightGreen)
      : (row.degraded ? color(`${theme.symbols.stale} Degraded`, ANSI.brightYellow) : color('Locked', ANSI.darkGray)),
    row.minted ? color(`${theme.symbols.ok} Minted`, ANSI.brightCyan) : color('Open', ANSI.slate),
  ]);
  return box(`${theme.symbols.diamond} Mint Scan`, [
    blankLine(),
    table(['Rank', 'Badge', 'QE', 'Backend', 'Chain'], tableRows),
    blankLine(),
  ], 88, { tone: ANSI.mint });
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
