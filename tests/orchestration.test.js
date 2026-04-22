const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAcrossAccounts } = require('../src/orchestration/runner');

test('all-account orchestration continues after one failure', async () => {
  const results = await runAcrossAccounts(['a', 'b', 'c'], async (account) => {
    if (account === 'b') throw new Error('boom');
    return { ok: true };
  });
  assert.equal(results.length, 3);
  assert.equal(results[1].ok, false);
  assert.equal(results[2].ok, true);
});

test('run-all preflight skips invalid accounts and continues valid ones', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-bot-'));
  const configPath = path.join(tempDir, 'dac.config.json');
  process.env.DAC_CONFIG_PATH = configPath;
  fs.writeFileSync(configPath, JSON.stringify({
    default: 'good',
    accounts: {
      bad: { privateKey: 'not-a-key' },
      good: { privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
    },
  }, null, 2));

  delete require.cache[require.resolve('../src/config/paths')];
  delete require.cache[require.resolve('../src/config/accounts')];
  delete require.cache[require.resolve('../src/config/preflight')];
  delete require.cache[require.resolve('../src/orchestration/run-all')];
  const { runAutomationAll } = require('../src/orchestration/run-all');

  const result = await runAutomationAll({
    contextFactory: async (accountName) => ({
      services: {
        automation: {
          run: async () => ({ accountName, done: true }),
        },
      },
    }),
  });

  delete process.env.DAC_CONFIG_PATH;

  assert.equal(result.preflight.ok, false);
  assert.equal(result.results.length, 2);
  assert.match(result.results[0].error, /preflight/);
  assert.equal(result.results[1].ok, true);
});
