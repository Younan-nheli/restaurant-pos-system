import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaiterApiOrigins, getWaiterApiEnvironment } from '../src/apiConfig.js';

test('local endpoint is preferred and cloud endpoint is retained as network fallback', () => {
  assert.deepEqual(createWaiterApiOrigins({
    localApiOrigin: 'https://local.pos.example.test',
    cloudApiOrigin: 'https://cloud.pos.example.test'
  }), ['https://local.pos.example.test', 'https://cloud.pos.example.test']);
});

test('legacy single-origin configuration remains supported and duplicates are removed', () => {
  assert.deepEqual(createWaiterApiOrigins({
    localApiOrigin: 'https://pos.example.test', legacyApiOrigin: 'https://pos.example.test'
  }), ['https://pos.example.test']);
  assert.deepEqual(getWaiterApiEnvironment({ EXPO_PUBLIC_POS_API_ORIGIN: 'https://legacy.example.test' }), ['https://legacy.example.test']);
});

test('non-HTTPS local network origins and empty endpoint configuration are rejected', () => {
  assert.throws(() => createWaiterApiOrigins({ localApiOrigin: 'http://192.168.1.20:3000' }), /HTTPS/);
  assert.throws(() => createWaiterApiOrigins({}), /Configure/);
});
