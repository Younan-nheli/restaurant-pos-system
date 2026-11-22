import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';

const valid = {
  POS_API_URL: 'https://pos.example.invalid',
  POS_ACCESS_TOKEN: 'test-only-token',
  POS_PRINT_GROUP: 'kitchen',
  PRINTER_HOST: '192.0.2.20'
};

test('loads a bounded station and printer configuration without exposing secrets', () => {
  const config = readConfig(valid);
  assert.equal(config.group, 'kitchen');
  assert.equal(config.printerPort, 9100);
  assert.equal(config.columns, 42);
  assert.equal(config.token, 'test-only-token');
  assert.equal(Object.isFrozen(config), true);
});

test('allows loopback HTTP only for local development', () => {
  assert.equal(readConfig({ ...valid, POS_API_URL: 'http://127.0.0.1:4000' }).apiOrigin, 'http://127.0.0.1:4000');
  assert.throws(() => readConfig({ ...valid, POS_API_URL: 'http://pos.example.invalid' }), /HTTPS/);
});

test('rejects missing credentials, invalid groups, unsafe hosts and out-of-range ports', () => {
  assert.throws(() => readConfig({ ...valid, POS_ACCESS_TOKEN: '' }), /required/);
  assert.throws(() => readConfig({ ...valid, POS_PRINT_GROUP: 'barista' }), /POS_PRINT_GROUP/);
  assert.throws(() => readConfig({ ...valid, PRINTER_HOST: 'bad host;command' }), /PRINTER_HOST/);
  assert.throws(() => readConfig({ ...valid, PRINTER_PORT: '70000' }), /PRINTER_PORT/);
  assert.throws(() => readConfig({ ...valid, POS_API_URL: 'https://user:pass@pos.example.invalid' }), /origin-only/);
});
