function sortRows(rows, sortBy = 'qe') {
  const getters = {
    qe: (row) => row.qe ?? -1,
    rank: (row) => row.rank ?? -1,
    badges: (row) => row.badges ?? -1,
    tasks: (row) => row.taskSummary?.done ?? -1,
  };
  const getter = getters[sortBy] || getters.qe;
  return [...rows].sort((a, b) => getter(b) - getter(a));
}

function normalizeRow(row) {
  if (row.result && typeof row.result === 'object' && !row.error) {
    return {
      accountName: row.result.accountName || row.account,
      ...row.result,
      account: row.account,
      error: null,
    };
  }
  return {
    accountName: row.accountName || row.account,
    account: row.account,
    rank: null,
    qe: null,
    badges: null,
    badgeTotal: null,
    streak: null,
    referralCount: null,
    taskSummary: { done: null, total: null },
    stale: false,
    error: row.error || null,
  };
}

function summarizeAccounts(rows) {
  const normalizedRows = rows.map(normalizeRow);
  const okRows = normalizedRows.filter((row) => !row.error);
  const failedRows = normalizedRows.filter((row) => row.error);
  return {
    totalAccounts: normalizedRows.length,
    okCount: okRows.length,
    failedCount: failedRows.length,
    totalQe: okRows.reduce((sum, row) => sum + Number(row.qe || 0), 0),
    totalBadges: okRows.reduce((sum, row) => sum + Number(row.badges || 0), 0),
    topAccounts: sortRows(okRows, 'qe').slice(0, 5),
    rows: normalizedRows,
    failedRows,
  };
}

module.exports = { sortRows, summarizeAccounts, normalizeRow };
