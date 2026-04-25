const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountProgressMap } = require('../src/tui/tracker');
const { stripAnsi } = require('../src/tui/theme');

test('account dashboard keeps rows compact and shows focused failure details', () => {
  const dashboard = new AccountProgressMap({
    title: 'Multi-Account Automation',
    width: 120,
    accountNames: ['main01', 'main02'],
  });
  const tracker = dashboard.createTracker('main01', 'Automation - main01');
  const receive = tracker.add('Receive');
  const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  tracker.start(receive.id);
  tracker.setTx(receive.id, {
    txHash,
    explorerUrl: `https://explorer.example/tx/${txHash}`,
  });
  tracker.fail(receive.id, new Error(`Transaction ${txHash} was not confirmed after 120000ms`));
  dashboard.setState('main01', { label: 'Receive', index: 9, total: 9 });
  dashboard.setError('main01', { failedStep: 'Receive', error: `Transaction ${txHash} was not confirmed after 120000ms` });

  const rendered = stripAnsi(dashboard.render());
  const mainRows = rendered.split('\n').filter((line) => line.includes('main01'));

  assert.equal(mainRows.length, 2);
  assert.match(rendered, /Details:\s+main01/);
  assert.match(rendered, /Tx:\s+0x1234567890abcdef/);
  assert.match(rendered, /Explorer:\s+https:\/\/explorer\.example\/tx\//);
  assert.match(rendered, /Diagnosis:\s+Transaction was submitted but not confirmed before timeout\./);
});
