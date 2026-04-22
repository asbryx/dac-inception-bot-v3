const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountCache } = require('../src/api/cache');

test('cache invalidation clears mutated keys', () => {
  const cache = new AccountCache();
  cache.set('main01', 'profile', { qe: 1 }, 1000);
  cache.set('main01', 'network', { block: 1 }, 1000);
  cache.invalidate('main01', ['profile']);
  assert.equal(cache.read('main01', 'profile').value, null);
  assert.deepEqual(cache.read('main01', 'network').value, { block: 1 });
});
