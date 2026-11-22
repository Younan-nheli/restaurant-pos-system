import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaiterApi, WaiterApiError, validateApiOrigin } from '../src/apiClient.js';

const restaurantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const user = { id: userId, restaurantId, role: 'waiter', email: 'waiter@example.test' };
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('API origin requires HTTPS except loopback development', () => {
  assert.equal(validateApiOrigin('https://pos.example.test'), 'https://pos.example.test');
  assert.equal(validateApiOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => validateApiOrigin('http://192.168.1.10:3000'), /HTTPS/);
  assert.throws(() => validateApiOrigin('https://user:pass@pos.example.test'), /HTTPS/);
});

test('login normalizes email and returns only a validated waiter identity', async () => {
  let request;
  const api = createWaiterApi({ apiOrigin: 'https://pos.example.test', fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return response(200, { accessToken: 'signed-token', user });
  }});
  const result = await api.login({ email: ' WAITER@EXAMPLE.TEST ', password: 'secret' });
  assert.equal(request.url, 'https://pos.example.test/api/v1/auth/login');
  assert.deepEqual(JSON.parse(request.options.body), { email: 'waiter@example.test', password: 'secret' });
  assert.equal(request.options.headers.authorization, undefined);
  assert.deepEqual(result, { accessToken: 'signed-token', user });
});

test('login rejects roles that must not use the waiter app and malformed server responses', async () => {
  const api = createWaiterApi({ apiOrigin: 'https://pos.example.test', fetchImpl: async () => response(200, {
    accessToken: 'token', user: { ...user, role: 'master_admin', restaurantId: null }
  }) });
  await assert.rejects(() => api.login({ email: 'a@b.test', password: 'secret' }), /invalid waiter identity/);
  const broken = createWaiterApi({ apiOrigin: 'https://pos.example.test', fetchImpl: async () => response(200, { user }) });
  await assert.rejects(() => broken.login({ email: 'a@b.test', password: 'secret' }), error => error instanceof WaiterApiError && error.code === 'invalid_server_response');
});

test('getMe sends bearer token and validates the returned identity', async () => {
  let request;
  const api = createWaiterApi({ apiOrigin: 'https://pos.example.test', fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return response(200, user);
  }});
  assert.deepEqual(await api.getMe('memory-token'), user);
  assert.equal(request.options.headers.authorization, 'Bearer memory-token');
  assert.equal(request.url, 'https://pos.example.test/api/v1/auth/me');
});

test('catalog rejects cross-tenant response even when HTTP succeeds', async () => {
  const api = createWaiterApi({ apiOrigin: 'https://pos.example.test', fetchImpl: async () => response(200, {
    restaurantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', restaurant: { currency: 'IQD', timezone: 'Asia/Baghdad' },
    serverTime: new Date().toISOString(), categories: [], items: [], serviceAreas: [], tables: []
  }) });
  await assert.rejects(() => api.getCatalog('token', restaurantId), error => error instanceof WaiterApiError && error.code === 'catalog_tenant_mismatch');
});

test('server errors are reduced to safe status and error codes', async () => {
  const api = createWaiterApi({ apiOrigin: 'https://pos.example.test', fetchImpl: async () => response(401, { error: 'invalid_or_expired_token', secret: 'must-not-leak' }) });
  await assert.rejects(() => api.getMe('token'), error => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'invalid_or_expired_token');
    assert.equal(error.message.includes('must-not-leak'), false);
    return true;
  });
});

test('API client falls back from local to cloud only after a network failure', async () => {
  const visited = [];
  const api = createWaiterApi({ apiOrigins: ['https://local.pos.test', 'https://cloud.pos.test'], fetchImpl: async url => {
    visited.push(String(url));
    if (String(url).startsWith('https://local.')) throw new Error('local offline');
    return response(200, user);
  }});
  assert.deepEqual(await api.getMe('token'), user);
  assert.deepEqual(visited, ['https://local.pos.test/api/v1/auth/me', 'https://cloud.pos.test/api/v1/auth/me']);
});

test('API client does not fail over after an HTTP authorization response', async () => {
  const visited = [];
  const api = createWaiterApi({ apiOrigins: ['https://local.pos.test', 'https://cloud.pos.test'], fetchImpl: async url => {
    visited.push(String(url));
    return response(401, { error: 'invalid_or_expired_token' });
  }});
  await assert.rejects(() => api.getMe('token'), error => error instanceof WaiterApiError && error.status === 401);
  assert.equal(visited.length, 1);
});
