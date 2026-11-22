import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreparationPrintJobs, canClaimPrintGroup, canManuallyRequeuePrintJob } from '../src/domain/printJobs.js';

const order = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  restaurant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  table_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  table_name: 'Terrace 4',
  currency: 'IQD',
  created_at: new Date('2026-11-14T10:00:00.000Z')
};
const items = [
  { id: '11111111-1111-4111-8111-111111111111', menu_item_id: '21111111-1111-4111-8111-111111111111', item_name: 'Burger', quantity: '2', unit_price: '7500.00', routing_group: 'kitchen', notes: null },
  { id: '12222222-2222-4222-8222-222222222222', menu_item_id: '22222222-2222-4222-8222-222222222222', item_name: 'Tea', quantity: '1', unit_price: '1000.00', routing_group: 'bar', notes: 'No sugar' },
  { id: '13333333-3333-4333-8333-333333333333', menu_item_id: '23333333-3333-4333-8333-333333333333', item_name: 'Fries', quantity: '1', unit_price: '2500.00', routing_group: 'kitchen', notes: '' }
];

test('creates one immutable snapshot per preparation station from persisted rows', () => {
  const jobs = buildPreparationPrintJobs({ order, items });
  assert.deepEqual(jobs.map(job => job.routingGroup), ['kitchen', 'bar']);
  assert.equal(jobs[0].restaurantId, order.restaurant_id);
  assert.equal(jobs[0].payload.items.length, 2);
  assert.equal(jobs[0].payload.items[0].name, 'Burger');
  assert.equal(jobs[0].payload.tableName, 'Terrace 4');
  assert.equal(jobs[1].payload.items[0].notes, 'No sugar');
  assert.equal(jobs[0].payload.createdAt, '2026-11-14T10:00:00.000Z');
  assert.equal(Object.isFrozen(jobs[0].payload.items), true);
});

test('rejects missing persisted order identity and invalid persisted item rows', () => {
  assert.throws(() => buildPreparationPrintJobs({ order: {}, items }), /persisted order/);
  assert.throws(() => buildPreparationPrintJobs({ order, items: [{ ...items[0], routing_group: 'cashier' }] }), /Invalid persisted/);
  assert.throws(() => buildPreparationPrintJobs({ order, items: [] }), /items are required/);
});

test('station workers can only claim their own print group', () => {
  assert.equal(canClaimPrintGroup('kitchen', 'kitchen'), true);
  assert.equal(canClaimPrintGroup('kitchen', 'bar'), false);
  assert.equal(canClaimPrintGroup('bar', 'bar'), true);
  assert.equal(canClaimPrintGroup('bar', 'other'), false);
  assert.equal(canClaimPrintGroup('restaurant_admin', 'other'), true);
  assert.equal(canClaimPrintGroup('waiter', 'kitchen'), false);
});

test('manual print-job recovery is restricted to failed jobs and Restaurant Admin', () => {
  assert.equal(canManuallyRequeuePrintJob('restaurant_admin', 'failed'), true);
  assert.equal(canManuallyRequeuePrintJob('restaurant_admin', 'pending'), false);
  assert.equal(canManuallyRequeuePrintJob('restaurant_admin', 'printing'), false);
  assert.equal(canManuallyRequeuePrintJob('kitchen', 'failed'), false);
  assert.equal(canManuallyRequeuePrintJob('bar', 'failed'), false);
});
