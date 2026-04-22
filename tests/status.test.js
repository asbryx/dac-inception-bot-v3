const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStatus } = require('../src/domain/status');

test('status normalization handles partial api data honestly', () => {
  const status = normalizeStatus({
    accountName: 'main01',
    profileData: { qe: 123, telegram_joined: true },
    networkData: null,
    catalogData: null,
    stale: true,
    errors: ['Timeout: GET /network/ after 12000ms'],
  });
  assert.equal(status.qe, 123);
  assert.equal(status.badgeTotal, null);
  assert.equal(status.network.blockNumber, null);
  assert.equal(status.stale, true);
  assert.equal(status.taskSummary.done, 1);
});
