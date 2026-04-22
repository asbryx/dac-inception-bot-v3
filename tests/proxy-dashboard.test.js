const test = require('node:test');
const assert = require('node:assert/strict');

const { createProxyRotation } = require('../src/addons/proxies');
const { renderProxyPanel } = require('../src/tui/panels');
const { canUseLiveProxyDashboard } = require('../src/cli/commands');
const { stripAnsi } = require('../src/tui/theme');

test('proxy rotation snapshot reports pool counts and failovers', async () => {
  const rotation = createProxyRotation([
    'http://proxy-01.example:8000',
    'http://proxy-02.example:8000',
    'http://proxy-03.example:8000',
  ]);

  const first = rotation.assign('wallet-1');
  rotation.assign('wallet-2');
  rotation.markSuccess(first);
  rotation.markFailure(first, new Error('Proxy HTTP 502'));
  await rotation.failover('wallet-1', first, {
    probe: async (candidate) => candidate.url === 'http://proxy-03.example:8000/',
  });

  const snapshot = rotation.snapshot();

  assert.equal(snapshot.total, 3);
  assert.equal(snapshot.used, 2);
  assert.equal(snapshot.failovers.length, 1);
  assert.equal(snapshot.assignments.find((row) => row.key === 'wallet-1').proxyUrl, 'http://proxy-03.example:8000/');
  assert.ok('healthy' in snapshot);
  assert.ok('assigned' in snapshot);
});

test('renderProxyPanel shows proxy pool and wallet mapping text', () => {
  const panel = renderProxyPanel({
    total: 3,
    used: 2,
    active: 2,
    healthy: 1,
    assigned: 0,
    cooldown: 1,
    unused: 0,
    assignments: [
      { key: 'wallet-1', proxyUrl: 'http://proxy-01.example:8000/', label: 'proxy-01.example:8000', source: 'rotation' },
      { key: 'wallet-2', proxyUrl: 'http://proxy-02.example:8000/', label: 'proxy-02.example:8000', source: 'rotation-failover' },
    ],
    rows: [
      { url: 'http://proxy-01.example:8000/', label: 'proxy-01.example:8000', status: 'healthy', assignedTo: ['wallet-1'], lastError: null },
      { url: 'http://proxy-02.example:8000/', label: 'proxy-02.example:8000', status: 'cooldown', assignedTo: ['wallet-2'], lastError: 'Proxy HTTP 502' },
      { url: 'http://proxy-03.example:8000/', label: 'proxy-03.example:8000', status: 'unused', assignedTo: [], lastError: null },
    ],
    failovers: [
      { key: 'wallet-2', from: 'http://proxy-01.example:8000/', to: 'http://proxy-02.example:8000/' },
    ],
  });

  const plain = stripAnsi(panel);
  assert.match(panel, /Proxy Pool/);
  assert.match(plain, /healthy 1/);
  assert.match(panel, /wallet-1/);
  assert.match(panel, /rotation-failover/);
  assert.match(panel, /Proxy HTTP 502/);
});

test('live proxy dashboard gating requires tty and enabled proxy rotation', () => {
  const rotation = createProxyRotation(['http://proxy-01.example:8000']);
  const originalTty = process.stdout.isTTY;

  try {
    process.stdout.isTTY = false;
    assert.equal(canUseLiveProxyDashboard(rotation), false);

    process.stdout.isTTY = true;
    assert.equal(canUseLiveProxyDashboard(rotation), true);
    assert.equal(canUseLiveProxyDashboard(null), false);
    assert.equal(canUseLiveProxyDashboard({ snapshot() {}, enabled: false }), false);
  } finally {
    process.stdout.isTTY = originalTty;
  }
});
