import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createWaiterCatalogCache } from '../src/catalogCache.js';
import { createWaiterOrderOutbox } from '../src/orderOutbox.js';

const restaurantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherRestaurantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const localId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const idempotencyKey = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const menuItemId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const areaId = '33333333-3333-4333-8333-333333333333';
const tableId = '44444444-4444-4444-8444-444444444444';

function createDb({ failOnTableInsert = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  let shouldFail = failOnTableInsert;
  return {
    execAsync: async sql => sqlite.exec(sql),
    runAsync: async (sql, ...params) => {
      if (shouldFail && sql.startsWith('INSERT INTO waiter_catalog_tables')) throw new Error('simulated catalog write failure');
      return sqlite.prepare(sql).run(...params);
    },
    getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...params),
    withTransactionAsync: async callback => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = await callback(); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    setFailOnTableInsert: value => { shouldFail = value; },
    close: () => sqlite.close()
  };
}

function sampleSnapshot(overrides = {}) {
  return {
    restaurantId,
    serverTime: '2026-11-19T17:00:00.000Z',
    restaurant: { currency: 'IQD', timezone: 'Asia/Baghdad' },
    categories: [{ id: categoryId, name: 'Meals', sortOrder: 1 }],
    items: [{ id: menuItemId, categoryId, name: 'Rice', price: '1250.00', routingGroup: 'kitchen', active: true }],
    serviceAreas: [{ id: areaId, name: 'Main Hall' }],
    tables: [{ id: tableId, serviceAreaId: areaId, serviceAreaName: 'Main Hall', tableName: 'T1', status: 'available' }],
    ...overrides
  };
}

async function setup(options) {
  const db = createDb(options);
  const cache = createWaiterCatalogCache(db);
  const outbox = createWaiterOrderOutbox(db);
  await cache.initialize();
  await outbox.initialize();
  return { db, cache, outbox };
}

test('stores and reads a tenant-scoped catalog snapshot with exact decimal prices', async () => {
  const { db, cache } = await setup();
  try {
    const saved = await cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot(), fetchedAt: 10_000 });
    assert.equal(saved.restaurantId, restaurantId);
    assert.equal(saved.restaurant.currency, 'IQD');
    assert.equal(saved.items[0].price, '1250.00');
    assert.equal(saved.items[0].routingGroup, 'kitchen');
    assert.equal(saved.tables[0].tableName, 'T1');
    assert.equal(saved.stale, false);
    assert.equal(await cache.getSnapshot({ restaurantId: otherRestaurantId, now: 10_000 }), null);
  } finally { db.close(); }
});

test('marks cached catalogs stale without deleting them when the device is offline', async () => {
  const { db, cache } = await setup();
  try {
    await cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot(), fetchedAt: 10_000 });
    const fresh = await cache.getSnapshot({ restaurantId, now: 20_000, maxAgeMs: 15_000 });
    const stale = await cache.getSnapshot({ restaurantId, now: 30_001, maxAgeMs: 15_000 });
    assert.equal(fresh.stale, false);
    assert.equal(stale.stale, true);
    assert.equal(stale.items.length, 1);
  } finally { db.close(); }
});

test('rejects cross-tenant, malformed, duplicate and invalid-reference catalog data before replacing cache', async () => {
  const { db, cache } = await setup();
  try {
    await cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot(), fetchedAt: 10_000 });
    await assert.rejects(() => cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot({ restaurantId: otherRestaurantId }), fetchedAt: 20_000 }), /different restaurant/);
    await assert.rejects(() => cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot({
      items: [{ id: menuItemId, categoryId: otherRestaurantId, name: 'Bad', price: '1.00', routingGroup: 'kitchen', active: true }]
    }), fetchedAt: 20_000 }), /outside this snapshot/);
    await assert.rejects(() => cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot({
      items: [{ id: menuItemId, categoryId, name: 'Bad', price: '1.001', routingGroup: 'kitchen', active: true }]
    }), fetchedAt: 20_000 }), /decimal string/);
    await assert.rejects(() => cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot({
      tables: [{ id: tableId, serviceAreaId: otherRestaurantId, serviceAreaName: 'Elsewhere', tableName: 'T1', status: 'available' }]
    }), fetchedAt: 20_000 }), /outside this snapshot/);
    const stillSaved = await cache.getSnapshot({ restaurantId, now: 10_000 });
    assert.equal(stillSaved.fetchedAt, 10_000);
    assert.equal(stillSaved.items[0].name, 'Rice');
  } finally { db.close(); }
});

test('catalog replacement is atomic and leaves the previous snapshot intact on write failure', async () => {
  const { db, cache } = await setup();
  try {
    await cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot(), fetchedAt: 10_000 });
    db.setFailOnTableInsert(true);
    const changed = sampleSnapshot({ items: [{ id: menuItemId, categoryId, name: 'Updated Rice', price: '1500.00', routingGroup: 'kitchen', active: true }] });
    await assert.rejects(() => cache.replaceSnapshot({ restaurantId, snapshot: changed, fetchedAt: 20_000 }), /simulated catalog write failure/);
    const saved = await cache.getSnapshot({ restaurantId, now: 10_000 });
    assert.equal(saved.fetchedAt, 10_000);
    assert.equal(saved.items[0].name, 'Rice');
  } finally { db.close(); }
});

test('clears only the selected restaurant catalog', async () => {
  const { db, cache } = await setup();
  try {
    await cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot(), fetchedAt: 10_000 });
    await cache.replaceSnapshot({ restaurantId: otherRestaurantId, snapshot: sampleSnapshot({ restaurantId: otherRestaurantId }), fetchedAt: 10_000 });
    await cache.clearRestaurant({ restaurantId });
    assert.equal(await cache.getSnapshot({ restaurantId, now: 10_000 }), null);
    assert.ok(await cache.getSnapshot({ restaurantId: otherRestaurantId, now: 10_000 }));
  } finally { db.close(); }
});

test('serializes catalog refresh and order enqueue transactions on the same SQLite connection', async () => {
  const { db, cache, outbox } = await setup();
  try {
    const [catalog, order] = await Promise.all([
      cache.replaceSnapshot({ restaurantId, snapshot: sampleSnapshot(), fetchedAt: 10_000 }),
      outbox.enqueue({
        restaurantId, userId, localId, idempotencyKey,
        payload: { tableId, items: [{ menuItemId, quantity: 1 }] }, now: 10_000
      })
    ]);
    assert.equal(catalog.items.length, 1);
    assert.equal(order.status, 'pending');
    assert.equal((await outbox.list({ restaurantId, userId })).length, 1);
  } finally { db.close(); }
});
