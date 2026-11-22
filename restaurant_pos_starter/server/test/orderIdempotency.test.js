import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderRequestHash } from '../src/domain/orderIdempotency.js';

const request = {
  tableId: '11111111-1111-4111-8111-111111111111',
  items: [
    { menuItemId: '22222222-2222-4222-8222-222222222222', quantity: 2, notes: 'No onions' },
    { menuItemId: '33333333-3333-4333-8333-333333333333', quantity: 1 }
  ]
};

test('order request hash is deterministic and SHA-256 encoded', () => {
  const first = createOrderRequestHash(request);
  assert.equal(createOrderRequestHash(request), first);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('hash ignores client-supplied catalog fields that the server does not trust', () => {
  const forged = {
    ...request,
    items: request.items.map(item => ({
      ...item,
      name: 'Forged product',
      unitPriceMinor: 1,
      routingGroup: 'bar'
    }))
  };
  assert.equal(createOrderRequestHash(forged), createOrderRequestHash(request));
});

test('hash changes when table, quantity, notes, or item order changes', () => {
  const original = createOrderRequestHash(request);
  assert.notEqual(createOrderRequestHash({ ...request, tableId: null }), original);
  assert.notEqual(createOrderRequestHash({
    ...request,
    items: [{ ...request.items[0], quantity: 3 }, request.items[1]]
  }), original);
  assert.notEqual(createOrderRequestHash({
    ...request,
    items: [{ ...request.items[0], notes: 'Extra spicy' }, request.items[1]]
  }), original);
  assert.notEqual(createOrderRequestHash({ ...request, items: [...request.items].reverse() }), original);
});

test('rejects a non-array items payload', () => {
  assert.throws(() => createOrderRequestHash({ tableId: null, items: null }), /items must be an array/);
});
