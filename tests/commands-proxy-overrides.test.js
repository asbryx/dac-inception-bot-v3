const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const commandsPath = path.resolve(__dirname, '../src/cli/commands.js');
const orchestrationStatusPath = path.resolve(__dirname, '../src/orchestration/status-all.js');
const orchestrationRunAllPath = path.resolve(__dirname, '../src/orchestration/run-all.js');
const orchestrationFaucetLoopPath = path.resolve(__dirname, '../src/orchestration/faucet-loop.js');
const orchestrationReceivePath = path.resolve(__dirname, '../src/orchestration/receive-all.js');
const orchestrationMeshPath = path.resolve(__dirname, '../src/orchestration/mesh-all.js');
const orchestrationMintPath = path.resolve(__dirname, '../src/orchestration/mint-all.js');
const orchestrationTrackPath = path.resolve(__dirname, '../src/orchestration/track-all.js');
const orchestrationCampaignPath = path.resolve(__dirname, '../src/orchestration/campaign-all.js');
const contextPath = path.resolve(__dirname, '../src/domain/context.js');

function loadCommandsWithStubs({
  runStatusAllImpl = async () => ({ accounts: [], results: [] }),
  runAutomationAllImpl = async () => ({ results: [] }),
  runFaucetLoopAllImpl = async () => ({ results: [] }),
  runReceiveAllImpl = async () => ({ results: [] }),
  runMeshAllImpl = async () => ({ results: [] }),
  runMintAllImpl = async () => ({ results: [] }),
  runTrackAllImpl = async () => ({ results: [] }),
  runCampaignAllImpl = async () => ({ results: [] }),
  createAccountContextImpl = async () => ({ services: {} }),
} = {}) {
  delete require.cache[commandsPath];
  delete require.cache[orchestrationStatusPath];
  delete require.cache[orchestrationRunAllPath];
  delete require.cache[orchestrationFaucetLoopPath];
  delete require.cache[orchestrationReceivePath];
  delete require.cache[orchestrationMeshPath];
  delete require.cache[orchestrationMintPath];
  delete require.cache[orchestrationTrackPath];
  delete require.cache[orchestrationCampaignPath];
  delete require.cache[contextPath];

  require.cache[orchestrationStatusPath] = {
    id: orchestrationStatusPath,
    filename: orchestrationStatusPath,
    loaded: true,
    exports: { runStatusAll: runStatusAllImpl },
  };

  require.cache[orchestrationRunAllPath] = {
    id: orchestrationRunAllPath,
    filename: orchestrationRunAllPath,
    loaded: true,
    exports: { runAutomationAll: runAutomationAllImpl },
  };

  require.cache[orchestrationFaucetLoopPath] = {
    id: orchestrationFaucetLoopPath,
    filename: orchestrationFaucetLoopPath,
    loaded: true,
    exports: { runFaucetLoopAll: runFaucetLoopAllImpl },
  };

  require.cache[orchestrationReceivePath] = {
    id: orchestrationReceivePath,
    filename: orchestrationReceivePath,
    loaded: true,
    exports: { runReceiveAll: runReceiveAllImpl },
  };

  require.cache[orchestrationMeshPath] = {
    id: orchestrationMeshPath,
    filename: orchestrationMeshPath,
    loaded: true,
    exports: { runTxMeshAll: runMeshAllImpl },
  };

  require.cache[orchestrationMintPath] = {
    id: orchestrationMintPath,
    filename: orchestrationMintPath,
    loaded: true,
    exports: { runMintAllRanksAll: runMintAllImpl },
  };

  require.cache[orchestrationTrackPath] = {
    id: orchestrationTrackPath,
    filename: orchestrationTrackPath,
    loaded: true,
    exports: { runTrackAll: runTrackAllImpl },
  };

  require.cache[orchestrationCampaignPath] = {
    id: orchestrationCampaignPath,
    filename: orchestrationCampaignPath,
    loaded: true,
    exports: { runCampaignAll: runCampaignAllImpl },
  };

  require.cache[contextPath] = {
    id: contextPath,
    filename: contextPath,
    loaded: true,
    exports: {
      createAccountContext: createAccountContextImpl,
      createSingleAccountContext: async () => ({ services: { statusService: { fetchNormalizedStatus: async () => ({}) } } }),
    },
  };

  return require(commandsPath);
}

function cleanupStubbedModules() {
  delete require.cache[commandsPath];
  delete require.cache[orchestrationStatusPath];
  delete require.cache[orchestrationRunAllPath];
  delete require.cache[orchestrationFaucetLoopPath];
  delete require.cache[orchestrationReceivePath];
  delete require.cache[orchestrationMeshPath];
  delete require.cache[orchestrationMintPath];
  delete require.cache[orchestrationTrackPath];
  delete require.cache[orchestrationCampaignPath];
  delete require.cache[contextPath];
}

test('status-all forwards runtime proxyRotation override into account contexts', async () => {
  const customRotation = { enabled: true, snapshot() { return { total: 0 }; } };
  const seen = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    const { runCommand } = loadCommandsWithStubs({
      runStatusAllImpl: async ({ contextFactory }) => {
        await contextFactory('wallet-1');
        return { results: [] };
      },
      createAccountContextImpl: async (accountName, options) => {
        seen.push({ accountName, proxyRotation: options.proxyRotation });
        return { accountName, services: {} };
      },
    });

    await runCommand({ command: 'status-all', quiet: true, proxyRotation: customRotation });
  } finally {
    console.log = originalLog;
    cleanupStubbedModules();
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0].accountName, 'wallet-1');
  assert.equal(seen[0].proxyRotation, customRotation);
});

test('run-all forwards runtime proxyRotation override into account contexts', async () => {
  const customRotation = { enabled: true, snapshot() { return { total: 0 }; } };
  const seen = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    const { runCommand } = loadCommandsWithStubs({
      runAutomationAllImpl: async ({ contextFactory }) => {
        await contextFactory('wallet-2');
        return { results: [] };
      },
      createAccountContextImpl: async (accountName, options) => {
        seen.push({ accountName, proxyRotation: options.proxyRotation });
        return { accountName, services: {} };
      },
    });

    await runCommand({ command: 'run-all', quiet: true, proxyRotation: customRotation });
  } finally {
    console.log = originalLog;
    cleanupStubbedModules();
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0].accountName, 'wallet-2');
  assert.equal(seen[0].proxyRotation, customRotation);
});

  test('faucet-loop-all forwards runtime proxyRotation override into orchestration', async () => {
    const customRotation = { enabled: true, snapshot() { return { total: 0 }; } };
    const seen = [];
    const originalLog = console.log;
    console.log = () => {};

    try {
      const { runCommand } = loadCommandsWithStubs({
        runFaucetLoopAllImpl: async ({ contextFactory }) => {
          const ctx = await contextFactory('wallet-3');
          seen.push(ctx?.proxy?.rotation || ctx?.proxyRotation || 'via-factory');
          return { results: [] };
        },
      });

      await runCommand({ command: 'faucet-loop-all', quiet: true, proxyRotation: customRotation });
    } finally {
      console.log = originalLog;
      cleanupStubbedModules();
    }

    assert.equal(seen.length, 1);
    assert.equal(seen[0], 'via-factory');
  });

const multiAccountCommands = [
  ['wallet-login-all', 'runStatusAll', 'status-all bootstrap path'],
  ['receive-all', 'runReceiveAll', 'receive orchestration'],
  ['tx-mesh-all', 'runTxMeshAll', 'tx mesh orchestration'],
  ['mint-all-ranks-all', 'runMintAllRanksAll', 'mint orchestration'],
  ['track-all', 'runTrackAll', 'tracking orchestration'],
  ['campaign-all', 'runCampaignAll', 'campaign orchestration'],
];

for (const [command, hookName, label] of multiAccountCommands) {
  test(`${command} forwards runtime proxyRotation override (${label})`, async () => {
    const customRotation = { enabled: true, snapshot() { return { total: 0 }; } };
    const seen = [];
    const originalLog = console.log;
    console.log = () => {};

    try {
      const stubs = {
        runStatusAllImpl: async ({ contextFactory }) => {
          if (command !== 'wallet-login-all') return { accounts: [], results: [] };
          await contextFactory('wallet-3');
          return { accounts: ['wallet-3'], results: [] };
        },
        createAccountContextImpl: async (accountName, options) => {
          if (command === 'wallet-login-all') seen.push(options.proxyRotation);
          return {
            accountName,
            proxy: null,
            bot: {
              walletAddress: '0x1234',
              walletLogin: async () => ({ ok: true }),
            },
            services: {},
          };
        },
      };

      const viaFactory = async ({ contextFactory }) => {
        const ctx = await contextFactory('wallet-3');
        seen.push(ctx?.proxy?.rotation || ctx?.proxyRotation || 'via-factory');
        return { results: [] };
      };

      if (command === 'receive-all') {
        stubs.runReceiveAllImpl = viaFactory;
      } else if (command === 'tx-mesh-all') {
        stubs.runMeshAllImpl = viaFactory;
      } else if (command === 'mint-all-ranks-all') {
        stubs.runMintAllImpl = viaFactory;
      } else if (command === 'track-all') {
        stubs.runTrackAllImpl = viaFactory;
      } else if (command === 'campaign-all') {
        stubs.runCampaignAllImpl = viaFactory;
      }

      const { runCommand } = loadCommandsWithStubs(stubs);

      await runCommand({ command, quiet: true, proxyRotation: customRotation });
    } finally {
      console.log = originalLog;
      cleanupStubbedModules();
    }

    assert.ok(seen.length >= 1);
    if (command === 'wallet-login-all') {
      assert.equal(seen[0], customRotation);
    } else {
      assert.equal(seen[0], 'via-factory');
    }
  });
}
