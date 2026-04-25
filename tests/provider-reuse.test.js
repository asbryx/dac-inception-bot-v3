const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUnits } = require('ethers');

const { DACBot, waitForTxReceipt, buildLegacyTransferRequest, classifyTxSubmitError } = require('../src/core/bot');

test('DACBot reuses a shared provider across instances', () => {
  const botA = new DACBot({ verbose: false, humanMode: false, fastMode: true });
  const botB = new DACBot({ verbose: false, humanMode: false, fastMode: true });

  assert.ok(botA.provider);
  assert.strictEqual(botA.provider, botB.provider);
});

test('waitForTxReceipt polls provider until receipt is available', async () => {
  let calls = 0;
  const provider = {
    async getTransactionReceipt(hash) {
      calls += 1;
      if (calls < 3) return null;
      return { hash, status: 1 };
    },
  };

  const receipt = await waitForTxReceipt(provider, '0xabc', { attempts: 5, delayMs: 0 });

  assert.equal(calls, 3);
  assert.deepEqual(receipt, { hash: '0xabc', status: 1 });
});


test('waitForTxReceipt rejects reverted receipts', async () => {
  const provider = {
    async getTransactionReceipt(hash) {
      return { hash, status: 0 };
    },
  };

  await assert.rejects(
    () => waitForTxReceipt(provider, '0xdead', { attempts: 1, delayMs: 0 }),
    /reverted/,
  );
});

test('buildLegacyTransferRequest uses RPC network metadata and a minimum gas price floor', async () => {
  const signer = { address: '0x1111111111111111111111111111111111111111' };
  const provider = {
    async getNetwork() {
      return { chainId: 21894n };
    },
    async getTransactionCount(address, blockTag) {
      assert.equal(address, signer.address);
      assert.equal(blockTag, 'pending');
      return 42;
    },
    async getFeeData() {
      return { gasPrice: 1n, maxFeePerGas: null };
    },
  };

  const request = await buildLegacyTransferRequest(signer, provider, {
    to: '0x2222222222222222222222222222222222222222',
    value: 1000n,
    gasLimit: 21000n,
  });

  assert.deepEqual(request, {
    to: '0x2222222222222222222222222222222222222222',
    value: 1000n,
    nonce: 42,
    gasLimit: 21000n,
    gasPrice: parseUnits('0.1', 'gwei'),
    chainId: 21894,
    type: 0,
  });
});


test('waitForTxReceipt can return pending instead of throwing on slow confirmation', async () => {
  const provider = { async getTransactionReceipt() { return null; } };

  const receipt = await waitForTxReceipt(provider, '0xslow', { attempts: 1, delayMs: 0, throwOnTimeout: false });

  assert.equal(receipt, null);
});

test('strategy spends all surplus above reserve without per-action cap', () => {
  const bot = new DACBot({ verbose: false, humanMode: false, fastMode: true });
  bot.wallet = { address: '0x1111111111111111111111111111111111111111' };
  const plan = bot.buildStrategy(
    { dacc: '1.25', qe: 1000, txCount: 10, faucetAvailable: false, faucetCooldownSeconds: 999 },
    { cost_per_open: 999999, opens_today: 0, daily_open_limit: 5 },
    { reserveDacc: '0.25', txAmount: '0.0001', txCount: 3, minBurnAmount: '0.01', minStakeAmount: '0.01', burnRatio: 0.25, stakeRatio: 0.25 },
  );

  const stake = plan.actions.find((action) => action.type === 'stake');
  const burn = plan.actions.find((action) => action.type === 'burn');

  assert.equal(stake.amount, '0.5');
  assert.equal(burn.amount, '0.5');
});


test('classifyTxSubmitError detects RPC fee-cap mint failures', () => {
  const classified = classifyTxSubmitError(new Error('tx fee (7.87 ether) exceeds the configured cap (1.00 ether)'));

  assert.equal(classified.status, 'blocked_fee_cap');
  assert.match(classified.reason, /exceeds the configured cap/);
});
