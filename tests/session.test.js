const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCookieHeader, mergeCookieStrings } = require('../src/auth/session');

test('session cookie merge preserves latest values', () => {
  const merged = mergeCookieStrings('a=1; b=2', 'b=3; c=4');
  assert.equal(merged, 'a=1; b=3; c=4');
});


test('cookie header drops Set-Cookie attributes', () => {
  const header = buildCookieHeader('sessionid=abc; Path=/; Expires=Wed, 21 Oct 2025 07:28:00 GMT; csrftoken=def; HttpOnly; SameSite=Lax');
  assert.equal(header, 'sessionid=abc; csrftoken=def');
});
