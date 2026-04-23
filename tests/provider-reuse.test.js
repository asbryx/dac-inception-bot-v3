const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUnits } = require('ethers');

const { DACBot, waitForTxReceipt, buildLegacyTransferRequest } = require('../src/core/bot');

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
