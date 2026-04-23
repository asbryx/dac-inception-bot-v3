const test = require('node:test');
const assert = require('node:assert/strict');
const { DACBot } = require('../src/core/bot');

test('mint scan handles missing profile without crashing', async () => {
  const bot = Object.create(DACBot.prototype);
  bot.status = async () => ({ qe: null, profile: undefined });
  bot.nft = null;
  bot.wallet = null;
  bot.claimSignature = async () => ({ success: false, error: 'no backend' });
  bot.humanPause = async () => {};
  bot.log = () => {};

  const rows = await bot.getMintableRanks();

  assert.ok(Array.isArray(rows));
  assert.ok(rows.length > 0);
  assert.equal(rows[0].degraded, true);
  assert.match(rows[0].scanError, /status profile unavailable/i);
});
