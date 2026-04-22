const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const commandsPath = path.resolve(__dirname, '../src/cli/commands.js');
const orchestrationStatusPath = path.resolve(__dirname, '../src/orchestration/status-all.js');
const orchestrationRunAllPath = path.resolve(__dirname, '../src/orchestration/run-all.js');
const contextPath = path.resolve(__dirname, '../src/domain/context.js');
const legacyRuntimePath = path.resolve(__dirname, '../src/legacy/runtime.js');

function loadCommandsWithStubs({
  runStatusAllImpl = async () => ({ accounts: [], results: [] }),
  runAutomationAllImpl = async () => ({ results: [] }),
  createAccountContextImpl = async () => ({ services: {} }),
  legacyRuntimeOverrides = {},
} = {}) {
  delete require.cache[commandsPath];
  delete require.cache[orchestrationStatusPath];
  delete require.cache[orchestrationRunAllPath];
  delete require.cache[contextPath];
  delete require.cache[legacyRuntimePath];

  require.cache[orchestrationStatusPath] = {
    id: orchestrationStatusPath,
    filename: orchestrationStatusPath,
    loaded: true,
    exports: {
      runStatusAll: runStatusAllImpl,
    },
  };

  require.cache[orchestrationRunAllPath] = {
    id: orchestrationRunAllPath,
    filename: orchestrationRunAllPath,
    loaded: true,
    exports: {
      runAutomationAll: runAutomationAllImpl,
    },
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

  require.cache[legacyRuntimePath] = {
    id: legacyRuntimePath,
    filename: legacyRuntimePath,
    loaded: true,
    exports: {
      DACBot: class {},
      orchestrateCampaignAll: async () => ({ results: [] }),
      orchestrateTrackAll: async () => ({ results: [] }),
      orchestrateMintAllRanks: async () => ({ results: [] }),
      orchestrateReceiveAll: async () => ({ results: [] }),
      orchestrateTxMeshAll: async () => ({ results: [] }),
      runMenu: async () => {},
      runManualActionMenu: async () => {},
      runFaucetLoop: async () => ({}),
      orchestrateFaucetLoopAll: async () => ({ results: [] }),
      ...legacyRuntimeOverrides,
    },
  };

  return require(commandsPath);
}

function cleanupStubbedModules() {
  delete require.cache[commandsPath];
  delete require.cache[orchestrationStatusPath];
  delete require.cache[orchestrationRunAllPath];
  delete require.cache[contextPath];
  delete require.cache[legacyRuntimePath];
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
      legacyRuntimeOverrides: {
        orchestrateFaucetLoopAll: async (options) => {
          seen.push(options.proxyRotation);
          return { results: [], proxyState: { total: 0 } };
        },
      },
    });

    await runCommand({ command: 'faucet-loop-all', quiet: true, proxyRotation: customRotation });
  } finally {
    console.log = originalLog;
    cleanupStubbedModules();
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0], customRotation);
});

const multiAccountLegacyCommands = [
  ['wallet-login-all', 'runStatusAll', 'status-all bootstrap path still reuses shared override'],
  ['receive-all', 'orchestrateReceiveAll', 'legacy receive orchestration'],
  ['tx-mesh-all', 'orchestrateTxMeshAll', 'legacy tx mesh orchestration'],
  ['mint-all-ranks-all', 'orchestrateMintAllRanks', 'legacy mint orchestration'],
  ['track-all', 'orchestrateTrackAll', 'legacy tracking orchestration'],
  ['campaign-all', 'orchestrateCampaignAll', 'legacy campaign orchestration'],
];

for (const [command, hookName, label] of multiAccountLegacyCommands) {
  test(`${command} forwards runtime proxyRotation override (${label})`, async () => {
    const customRotation = { enabled: true, snapshot() { return { total: 0 }; } };
    const seen = [];
    const originalLog = console.log;
    console.log = () => {};

    try {
      const legacyRuntimeOverrides = {
        [hookName]: async (options) => {
          seen.push(options.proxyRotation);
          if (command === 'wallet-login-all') return { accounts: ['wallet-3'], results: [] };
          return { results: [] };
        },
      };

      const { runCommand } = loadCommandsWithStubs({
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
        legacyRuntimeOverrides,
      });

      await runCommand({ command, quiet: true, proxyRotation: customRotation });
    } finally {
      console.log = originalLog;
      cleanupStubbedModules();
    }

    assert.ok(seen.length >= 1);
    assert.equal(seen[0], customRotation);
  });
}
