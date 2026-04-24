const test = require('node:test');
const assert = require('node:assert/strict');
const { getApiTimeoutMs, fetchApiPayload } = require('../src/api/endpoints');

test('read endpoints use longer timeout budget', () => {
  assert.equal(getApiTimeoutMs('/profile/'), 25000);
  assert.equal(getApiTimeoutMs('/network/'), 25000);
  assert.equal(getApiTimeoutMs('/task/claim'), 12000);
});

test('timeout fallback preserves endpoint-specific message and stale flag', async () => {
  const bot = {
    apiBase: 'https://example.invalid',
    apiClient: {
      fetchWithSession: async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
      fetchJsonResponse: async () => ({}),
    },
    getCachedValue: (key) => {
      if (key === 'profile') return { qe_balance: 7 };
      return null;
    },
  };

  const result = await fetchApiPayload(bot, '/profile/', { method: 'GET' });
  assert.equal(result._stale, true);
  assert.equal(result._timeout, true);
  assert.match(result.error, /Timeout: GET \/profile\//);
});


test('read endpoints retry retryable http statuses', async () => {
  let calls = 0;
  const bot = {
    apiBase: 'https://example.invalid',
    fastMode: true,
    apiClient: {
      fetchWithSession: async () => {
        calls += 1;
        return { status: calls === 1 ? 500 : 200 };
      },
      fetchJsonResponse: async (response) => (response.status === 200 ? { ok: true } : { error: 'temporary' }),
    },
    getCachedValue: () => null,
  };

  const result = await fetchApiPayload(bot, '/profile/', { method: 'GET' });

  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result._status, 200);
});


test('read endpoints return final retryable payload after retries are exhausted', async () => {
  let calls = 0;
  const bot = {
    apiBase: 'https://example.invalid',
    fastMode: true,
    apiClient: {
      fetchWithSession: async () => {
        calls += 1;
        return { status: 503 };
      },
      fetchJsonResponse: async () => ({ error: 'still down' }),
    },
    getCachedValue: () => null,
  };

  const result = await fetchApiPayload(bot, '/profile/', { method: 'GET' });

  assert.equal(calls, 2);
  assert.equal(result._status, 503);
  assert.equal(result.error, 'still down');
});
