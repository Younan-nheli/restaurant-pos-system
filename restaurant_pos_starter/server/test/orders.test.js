import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderDraft,
  buildOrderDraftFromCatalog,
  canTransitionItemStatus,
  decimalToMinorUnits,
  deriveOrderStatus
} from '../src/domain/orders.js';

const sample = {
  restaurantId: 'restaurant-a',
  tableId: 'table-4',
  waiterId: 'waiter-2',
  items: [
    { menuItemId: 'meal-1', name: 'Grilled chicken', quantity: 2, unitPriceMinor: 7500, routingGroup: 'kitchen' },
    { menuItemId: 'drink-1', name: 'Orange juice', quantity: 1, unitPriceMinor: 2000, routingGroup: 'bar' },
    { menuItemId: 'meal-2', name: 'Soup', quantity: 1, unitPriceMinor: 1500, routingGroup: 'kitchen', notes: 'No salt' }
  ]
};

test('calculates the order subtotal using integer hundredths', () => {
  const order = buildOrderDraft(sample);
  assert.equal(order.subtotalMinor, 18500);
  assert.equal(order.items[0].lineTotalMinor, 15000);
  assert.equal(order.currency, 'IQD');
});

test('routes food and drinks into separate preparation tickets', () => {
  const order = buildOrderDraft(sample);
  assert.deepEqual(order.tickets.map(ticket => ticket.routingGroup), ['kitchen', 'bar']);
  assert.deepEqual(order.tickets[0].items.map(item => item.name), ['Grilled chicken', 'Soup']);
  assert.deepEqual(order.tickets[1].items.map(item => item.name), ['Orange juice']);
  assert.equal(order.tickets[0].subtotalMinor + order.tickets[1].subtotalMinor, order.subtotalMinor);
});

test('uses only active server catalog values, ignoring client names and prices', () => {
  const order = buildOrderDraftFromCatalog({
    restaurantId: 'restaurant-a', waiterId: 'waiter-2', currency: 'IQD',
    requestedItems: [{ menuItemId: 'menu-1', quantity: 2, name: 'Forged name', unitPriceMinor: 1 }],
    catalogItems: [{ id: 'menu-1', name: 'Tea', price: '1250.50', routing_group: 'bar', active: true }]
  });
  assert.equal(order.items[0].name, 'Tea');
  assert.equal(order.items[0].unitPriceMinor, 125050);
  assert.equal(order.items[0].unitPriceDecimal, '1250.50');
  assert.equal(order.items[0].routingGroup, 'bar');
  assert.equal(order.subtotalMinor, 250100);
});

test('parses decimal prices without floating-point arithmetic', () => {
  assert.equal(decimalToMinorUnits('0'), 0);
  assert.equal(decimalToMinorUnits('12.3'), 1230);
  assert.equal(decimalToMinorUnits('12.34'), 1234);
  assert.throws(() => decimalToMinorUnits('1.005'), /at most two decimal places/);
  assert.throws(() => decimalToMinorUnits(1.005), /at most two decimal places/);
});

test('rejects unavailable catalog items, empty orders and invalid quantities', () => {
  assert.throws(() => buildOrderDraftFromCatalog({
    restaurantId: 'r', waiterId: 'w', requestedItems: [{ menuItemId: 'missing', quantity: 1 }], catalogItems: []
  }), /unavailable menu item/);
  assert.throws(() => buildOrderDraft({ ...sample, items: [] }), /at least one item/);
  assert.throws(() => buildOrderDraft({ ...sample, items: [{ ...sample.items[0], quantity: 0 }] }), /between 1 and 999/);
});

test('rejects unsupported printer routing groups and unsafe totals', () => {
  assert.throws(() => buildOrderDraft({ ...sample, items: [{ ...sample.items[0], routingGroup: 'cashier' }] }), /routingGroup is invalid/);
  assert.throws(() => buildOrderDraft({
    ...sample,
    items: [{ menuItemId: 'x', name: 'Large', quantity: 2, unitPriceMinor: Number.MAX_SAFE_INTEGER }]
  }), /total is too large/);
});

test('enforces forward-only preparation status transitions', () => {
  assert.equal(canTransitionItemStatus('pending', 'preparing'), true);
  assert.equal(canTransitionItemStatus('preparing', 'ready'), true);
  assert.equal(canTransitionItemStatus('ready', 'served'), true);
  assert.equal(canTransitionItemStatus('served', 'preparing'), false);
  assert.equal(canTransitionItemStatus('pending', 'void'), false);
  assert.equal(canTransitionItemStatus('pending', 'void', { allowVoid: true }), true);
  assert.equal(canTransitionItemStatus('ready', 'ready'), true);
});

test('derives order progress from all kitchen and bar items', () => {
  assert.equal(deriveOrderStatus(['pending', 'pending']), 'sent');
  assert.equal(deriveOrderStatus(['preparing', 'pending']), 'preparing');
  assert.equal(deriveOrderStatus(['ready', 'preparing']), 'preparing');
  assert.equal(deriveOrderStatus(['ready', 'pending']), 'preparing');
  assert.equal(deriveOrderStatus(['ready', 'void']), 'ready');
  assert.equal(deriveOrderStatus(['served', 'void']), 'served');
  assert.equal(deriveOrderStatus(['void', 'void']), 'void');
});
