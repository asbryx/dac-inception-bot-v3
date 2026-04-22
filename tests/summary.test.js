const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSummary, renderSummaryBundle, renderFailuresPanel } = require('../src/tui/panels');
const { summarizeAccounts } = require('../src/domain/summary');
const { stripAnsi } = require('../src/tui/theme');

test('summary rendering shows unknown badge totals honestly', () => {
  const text = renderSummary({
    totalAccounts: 1,
    okCount: 1,
    failedCount: 0,
    totalQe: 5,
    totalBadges: 2,
    rows: [{ accountName: 'main01', rank: 1, qe: 5, badges: 2, badgeTotal: null, taskSummary: { done: 1, total: 6 }, streak: null, referralCount: null }],
  });
  assert.match(stripAnsi(text), /2\/\?/);
});

test('summary rendering shows unknown values honestly and includes failures', () => {
  const summary = summarizeAccounts([
    { account: 'main01', result: { accountName: 'main01', qe: null, rank: null, badges: null, badgeTotal: null, taskSummary: { done: null, total: null }, streak: null, referralCount: null, stale: true } },
    { account: 'main02', ok: false, error: 'main02 | status-all | GET /profile/ | Timeout: GET /profile/ after 25000ms' },
  ]);
  const text = `${renderSummary(summary)}\n${renderFailuresPanel(summary.failedRows)}`;
  const plain = stripAnsi(text);
  assert.match(plain, /accounts 2/);
  assert.match(plain, /ok 1/);
  assert.match(plain, /failed 1/);
  assert.match(plain, /\?\/\?/);
  assert.match(text, /Failures/);
  assert.match(text, /main02/);
  assert.match(text, /Timeout: GET \/profile\//);
});

test('failures panel shortens very long errors cleanly', () => {
  const text = renderFailuresPanel([
    { account: 'main99', error: 'main99 | run-all | GET /profile/ | ' + 'x'.repeat(180) },
  ]);
  assert.match(text, /main99/);
  assert.ok(stripAnsi(text).length < 700);
});

test('summary bundle chunks large account lists cleanly', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    account: `main${String(index + 1).padStart(2, '0')}`,
    result: {
      accountName: `main${String(index + 1).padStart(2, '0')}`,
      qe: index,
      rank: 1,
      badges: 1,
      badgeTotal: 5,
      taskSummary: { done: 1, total: 6 },
      streak: 1,
      referralCount: 0,
      stale: false,
    },
  }));
  const text = renderSummaryBundle(summarizeAccounts(rows));
  assert.match(text, /Overview/);
  assert.match(text, /Top Accounts/);
  assert.match(text, /Page 1\/3/);
  assert.match(text, /Page 3\/3/);
});
