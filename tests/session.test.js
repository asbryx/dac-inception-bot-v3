const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeCookieStrings } = require('../src/auth/session');

test('session cookie merge preserves latest values', () => {
  const merged = mergeCookieStrings('a=1; b=2', 'b=3; c=4');
  assert.equal(merged, 'a=1; b=3; c=4');
});
