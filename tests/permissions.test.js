const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('secret file writes use 0600 permissions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-bot-v2-'));
  process.env.DAC_CONFIG_PATH = path.join(dir, 'dac.config.json');
  delete require.cache[require.resolve('../src/config/paths')];
  delete require.cache[require.resolve('../src/config/secrets')];
  delete require.cache[require.resolve('../src/config/files')];
  const { writeJson } = require('../src/config/files');
  const file = process.env.DAC_CONFIG_PATH;
  writeJson(file, { secret: true });
  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);
});
