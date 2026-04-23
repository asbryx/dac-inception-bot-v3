const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/cli/args');

test('numeric args are clamped to safe defaults', () => {
  const result = parseArgs(['node', 'cli', 'status', '--interval', 'foo', '--tx-count', '-10']);
  assert.equal(result.interval, 360);
  assert.equal(result.txCount, 3);
});

test('--accounts parses comma-separated list', () => {
  const result = parseArgs(['node', 'cli', 'run-all', '--accounts', 'alice,bob,charlie']);
  assert.deepEqual(result.accounts, ['alice', 'bob', 'charlie']);
});

test('--accounts handles spaces and empty entries', () => {
  const result = parseArgs(['node', 'cli', 'run-all', '--accounts', 'alice, bob, , charlie']);
  assert.deepEqual(result.accounts, ['alice', 'bob', 'charlie']);
});
