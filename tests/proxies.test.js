const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeProxySettings,
  createProxyRotation,
  resolveAccountProxy,
} = require('../src/addons/proxies');
const { fetchWithSession } = require('../src/api/client');
const { createSingleAccountContext } = require('../src/domain/context');

test('normalizeProxySettings keeps only valid proxy urls and fills failover defaults', () => {
  const settings = normalizeProxySettings({
    enabled: true,
    list: [
      'http://user:pass@proxy-01.example:8000',
      'not-a-url',
      { url: 'https://proxy-02.example:8443', label: 'backup' },
    ],
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.list.length, 2);
  assert.equal(settings.list[0].url, 'http://user:pass@proxy-01.example:8000/');
  assert.equal(settings.list[1].label, 'backup');
  assert.equal(settings.failover.enabled, true);
  assert.equal(settings.failover.maxAttemptsPerRequest, 3);
});

test('createProxyRotation assigns proxies per wallet key and keeps affinity', () => {
  const rotation = createProxyRotation([
    'http://proxy-01.example:8000',
    'http://proxy-02.example:8000',
  ]);

  const walletOne = rotation.assign('wallet-1');
  const walletTwo = rotation.assign('wallet-2');
  const walletOneAgain = rotation.assign('wallet-1');
  const walletThree = rotation.assign('wallet-3');

  assert.equal(walletOne.url, 'http://proxy-01.example:8000/');
  assert.equal(walletTwo.url, 'http://proxy-02.example:8000/');
  assert.equal(walletOneAgain.url, walletOne.url);
  assert.equal(walletThree.url, 'http://proxy-01.example:8000/');
});

test('resolveAccountProxy prefers account override before shared rotation', () => {
  const rotation = createProxyRotation([
    'http://proxy-01.example:8000',
    'http://proxy-02.example:8000',
  ]);

  const explicit = resolveAccountProxy('alpha', {
    accountConfig: { proxy: 'http://dedicated.example:9000' },
    proxyRotation: rotation,
  });
  const shared = resolveAccountProxy('beta', { proxyRotation: rotation });

  assert.equal(explicit.proxy.url, 'http://dedicated.example:9000/');
  assert.equal(explicit.source, 'explicit');
  assert.equal(shared.proxy.url, 'http://proxy-01.example:8000/');
  assert.equal(shared.source, 'rotation');
});

test('proxy rotation fails over to next healthy proxy and updates wallet assignment', async () => {
  const rotation = createProxyRotation([
    'http://proxy-01.example:8000',
    'http://proxy-02.example:8000',
    'http://proxy-03.example:8000',
  ], {
    failover: {
      enabled: true,
      cooldownMs: 1000,
      maxAttemptsPerRequest: 3,
    },
  });

  const first = rotation.assign('wallet-1');
  rotation.markFailure(first, new Error('down'));

  const failedCandidate = [];
  const replacement = await rotation.failover('wallet-1', first, {
    probe: async (candidate) => {
      failedCandidate.push(candidate.url);
      return candidate.url === 'http://proxy-03.example:8000/';
    },
  });

  assert.equal(first.url, 'http://proxy-01.example:8000/');
  assert.deepEqual(failedCandidate, [
    'http://proxy-02.example:8000/',
    'http://proxy-03.example:8000/',
  ]);
  assert.equal(replacement.url, 'http://proxy-03.example:8000/');
  assert.equal(rotation.assign('wallet-1').url, 'http://proxy-03.example:8000/');
});

test('proxy snapshot clears cooldown status after cooldown window expires', () => {
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;

  try {
    const rotation = createProxyRotation([
      'http://proxy-01.example:8000',
    ], {
      failover: {
        enabled: true,
        cooldownMs: 1000,
      },
    });

    const first = rotation.assign('wallet-1');
    rotation.markSuccess(first);
    rotation.markFailure(first, new Error('down'));

    let snapshot = rotation.snapshot();
    assert.equal(snapshot.rows[0].status, 'cooldown');

    now += 1001;
    snapshot = rotation.snapshot();
    assert.equal(snapshot.rows[0].status, 'healthy');
  } finally {
    Date.now = originalNow;
  }
});

test('explicit account proxy stays isolated from shared failover pool', async () => {
  const explicitProxy = { url: 'http://dedicated.example:9000/', label: 'dedicated' };
  const rotation = createProxyRotation([
    'http://proxy-01.example:8000',
    'http://proxy-02.example:8000',
  ]);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('dedicated proxy down');
  };

  const bot = {
    rotateUserAgent() {},
    session: { cookieHeader: '', csrf: '', userAgent: 'ua', cookies: '' },
    buildDefaultHeaders() { return {}; },
    setSession() {},
    baseUrl: 'https://inception.dachain.io',
    proxy: explicitProxy,
    proxySource: 'explicit',
    proxyKey: 'wallet-1',
    proxyRotation: rotation,
  };

  await assert.rejects(() => fetchWithSession(bot, 'https://inception.dachain.io/api/inception/network/'), /dedicated proxy down/);
  assert.equal(bot.proxy.url, explicitProxy.url);

  global.fetch = originalFetch;
});

test('HTTP proxy failure response triggers failover to next healthy proxy', async () => {
  const rotation = createProxyRotation([
    'http://proxy-01.example:8000',
    'http://proxy-02.example:8000',
  ]);
  const assigned = rotation.assign('wallet-1');

  const originalFetch = global.fetch;
  let profileCalls = 0;
  let probeCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('/api/inception/network/') && probeCalls === 0) {
      probeCalls += 1;
      return { status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
    }
    if (String(url).includes('/api/inception/profile/') && profileCalls === 0) {
      profileCalls += 1;
      return { status: 502, headers: { get: () => null }, json: async () => ({}), text: async () => 'bad gateway' };
    }
    return { status: 200, headers: { get: () => null }, json: async () => ({ ok: true }), text: async () => 'ok' };
  };

  const bot = {
    rotateUserAgent() {},
    session: { cookieHeader: '', csrf: '', userAgent: 'ua', cookies: '' },
    buildDefaultHeaders() { return {}; },
    setSession() {},
    baseUrl: 'https://inception.dachain.io',
    proxy: assigned,
    proxySource: 'rotation',
    proxyKey: 'wallet-1',
    proxyRotation: rotation,
  };

  const response = await fetchWithSession(bot, 'https://inception.dachain.io/api/inception/profile/');
  assert.equal(response.status, 200);
  assert.equal(bot.proxy.url, 'http://proxy-02.example:8000/');

  global.fetch = originalFetch;
});

test('bad HTTP proxy response without failover does not mark proxy healthy', async () => {
  const rotation = createProxyRotation(['http://proxy-01.example:8000']);
  const assigned = rotation.assign('wallet-1');

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    status: 502,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => 'bad gateway',
  });

  const bot = {
    rotateUserAgent() {},
    session: { cookieHeader: '', csrf: '', userAgent: 'ua', cookies: '' },
    buildDefaultHeaders() { return {}; },
    setSession() {},
    baseUrl: 'https://inception.dachain.io',
    proxy: assigned,
    proxySource: 'rotation',
    proxyKey: 'wallet-1',
    proxyRotation: rotation,
  };

  const response = await fetchWithSession(bot, 'https://inception.dachain.io/api/inception/profile/');
  assert.equal(response.status, 502);
  assert.equal(rotation.healthState.get(assigned.url).lastError, 'Proxy HTTP 502');
  assert.equal(rotation.healthState.get(assigned.url).lastFailedAt != null, true);

  global.fetch = originalFetch;
});

test('single-account context forwards proxy rotation settings', async () => {
  const rotation = createProxyRotation(['http://proxy-01.example:8000']);
  const context = await createSingleAccountContext({
    account: 'main01',
    quiet: true,
    fast: true,
    privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    proxyRotation: rotation,
  });

  assert.equal(context.proxy.url, 'http://proxy-01.example:8000/');
});

test('same wallet reuses the same proxy key across different account names', async () => {
  const rotation = createProxyRotation([
    'http://proxy-01.example:8000',
    'http://proxy-02.example:8000',
  ]);
  const privateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const first = await createSingleAccountContext({
    account: 'main01',
    quiet: true,
    fast: true,
    privateKey,
    proxyRotation: rotation,
  });
  const second = await createSingleAccountContext({
    account: 'main02',
    quiet: true,
    fast: true,
    privateKey,
    proxyRotation: rotation,
  });

  assert.equal(first.bot.proxyKey, second.bot.proxyKey);
  assert.equal(first.proxy.url, second.proxy.url);
});

test('accounts config normalization preserves proxy addon settings', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-bot-proxy-'));
  const configPath = path.join(tempDir, 'dac.config.json');
  process.env.DAC_CONFIG_PATH = configPath;

  fs.writeFileSync(configPath, JSON.stringify({
    default: 'main01',
    addons: {
      proxies: {
        enabled: true,
        list: ['http://proxy-01.example:8000'],
      },
    },
    accounts: {
      main01: {
        privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    },
  }, null, 2));

  delete require.cache[require.resolve('../src/addons/proxies')];
  delete require.cache[require.resolve('../src/config/paths')];
  delete require.cache[require.resolve('../src/config/files')];
  delete require.cache[require.resolve('../src/config/accounts')];
  const { loadAccountsConfig } = require('../src/config/accounts');

  const config = loadAccountsConfig();

  delete process.env.DAC_CONFIG_PATH;

  assert.equal(config.addons.proxies.enabled, true);
  assert.equal(config.addons.proxies.list[0].url, 'http://proxy-01.example:8000/');
  assert.equal(config.addons.proxies.failover.enabled, true);
});
