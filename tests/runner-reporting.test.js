const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAcrossAccounts } = require('../src/orchestration/runner');
const { classifyFailure, writeRunReport, loadResumeReport, successfulAccounts } = require('../src/orchestration/reporting');

test('runAcrossAccounts records durations and classifies failures', async () => {
  const results = await runAcrossAccounts(['ok', 'bad'], async (account) => {
    if (account === 'bad') throw new Error('fetch failed socket hang up');
    return { done: true };
  }, { action: 'test' });

  assert.equal(results[0].ok, true);
  assert.equal(typeof results[0].durationMs, 'number');
  assert.equal(results[1].ok, false);
  assert.equal(results[1].failureType, 'network');
});

test('runAcrossAccounts applies per-account timeout', async () => {
  const results = await runAcrossAccounts(['slow'], () => new Promise((resolve) => setTimeout(resolve, 30)), {
    timeoutMs: 5,
  });

  assert.equal(results[0].ok, false);
  assert.equal(results[0].failureType, 'timeout');
});

test('reporting persists JSON reports and exposes successful accounts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-report-'));
  const file = path.join(dir, 'report.json');
  writeRunReport({ task: 'test', results: [{ account: 'a', ok: true }, { account: 'b', ok: false }] }, file);

  const loaded = loadResumeReport(file);
  assert.deepEqual([...successfulAccounts(loaded)], ['a']);
});

test('classifyFailure maps common operational errors', () => {
  assert.equal(classifyFailure('csrf 403'), 'auth');
  assert.equal(classifyFailure('429 too many requests'), 'rate-limit');
  assert.equal(classifyFailure('private key missing'), 'config');
});
