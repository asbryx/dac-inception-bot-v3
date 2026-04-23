const test = require('node:test');
const assert = require('node:assert/strict');

const originalLog = console.log;

test.beforeEach(() => {
  console.log = () => {};
});

test.afterEach(() => {
  console.log = originalLog;
});

function stubModule(modulePath, exportsValue) {
  delete require.cache[require.resolve(modulePath)];
  require.cache[require.resolve(modulePath)] = {
    id: require.resolve(modulePath),
    filename: require.resolve(modulePath),
    loaded: true,
    exports: exportsValue,
  };
}

test('status-all command uses modular handler instead of legacyMain', async () => {
  let statusAllCalled = false;

  stubModule('../src/domain/context', { createAccountContext: async (accountName) => ({ accountName, services: { statusService: { fetchNormalizedStatus: async () => ({ accountName, qe: null, rank: null, badges: null, badgeTotal: null, taskSummary: { done: null, total: null }, streak: null, referralCount: null }) } } }) });
  stubModule('../src/orchestration/status-all', { runStatusAll: async () => { statusAllCalled = true; return { results: [] }; } });
  delete require.cache[require.resolve('../src/cli/commands')];
  const { runCommand } = require('../src/cli/commands');

  await runCommand({ command: 'status-all', quiet: true, fast: false, profile: 'balanced' });

  assert.equal(statusAllCalled, true);
});

test('run-all command uses modular handler instead of legacyMain', async () => {
  let runAllCalled = false;

  stubModule('../src/domain/context', { createAccountContext: async () => ({ services: { automation: { run: async () => ({}) } } }) });
  stubModule('../src/orchestration/run-all', { runAutomationAll: async () => { runAllCalled = true; return { results: [] }; } });
  delete require.cache[require.resolve('../src/cli/commands')];
  const { runCommand } = require('../src/cli/commands');

  await runCommand({ command: 'run-all', quiet: true, fast: false, profile: 'balanced', txCount: 3, txAmount: '0.0001', strategyFlag: false });

  assert.equal(runAllCalled, true);
});

test('status command uses modular handler instead of legacyMain', async () => {
  stubModule('../src/domain/context', {
    createAccountContext: async () => ({}),
    createSingleAccountContext: async () => ({
      wallet: { address: '0xabc' },
      services: {
        statusService: {
          fetchNormalizedStatus: async () => ({ accountName: 'main01', qe: 1, rank: 1, badges: 1, badgeTotal: 2, taskSummary: { done: 1, total: 6 } }),
        },
      },
    }),
  });
  delete require.cache[require.resolve('../src/cli/commands')];
  const { runCommand } = require('../src/cli/commands');

  await runCommand({ command: 'status', quiet: true, fast: false });
});

test('run command uses modular handler instead of legacyMain', async () => {
  let runCalled = false;

  stubModule('../src/domain/context', {
    createAccountContext: async () => ({}),
    createSingleAccountContext: async () => ({
      services: {
        automation: {
          run: async () => {
            runCalled = true;
            return { ok: true };
          },
        },
      },
    }),
  });
  delete require.cache[require.resolve('../src/cli/commands')];
  const { runCommand } = require('../src/cli/commands');

  await runCommand({ command: 'run', quiet: true, fast: false, profile: 'balanced', txCount: 3, txAmount: '0.0001', strategyFlag: false, json: false });

  assert.equal(runCalled, true);
});
