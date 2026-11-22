import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createWaiterOrderOutbox, syncOneWaiterOrder } from '../src/orderOutbox.js';

const restaurantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const localId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const key = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const lease1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const lease2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const menuItemId = '11111111-1111-4111-8111-111111111111';
const serverOrderId = '22222222-2222-4222-8222-222222222222';
const payload = { tableId: null, items: [{ menuItemId, quantity: 2, notes: 'No onions' }] };

function createDb() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    execAsync: async sql => sqlite.exec(sql),
    runAsync: async (sql, ...params) => sqlite.prepare(sql).run(...params),
    getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...params),
    withTransactionAsync: async callback => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = await callback(); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close: () => sqlite.close()
  };
}

async function setup() {
  const db = createDb();
  const outbox = createWaiterOrderOutbox(db);
  await outbox.initialize();
  return { db, outbox };
}

async function enqueue(outbox, overrides = {}) {
  return outbox.enqueue({ restaurantId, userId, localId, idempotencyKey: key, payload, now: 1_000, ...overrides });
}

const response = (status, data) => ({ status, json: async () => data });

test('creates a durable tenant/user-scoped order row with a canonical payload', async () => {
  const { db, outbox } = await setup();
  try {
    const row = await enqueue(outbox);
    assert.equal(row.status, 'pending');
    assert.equal(row.attempt_count, 0);
    assert.deepEqual(row.payload, payload);
    assert.equal(row.idempotency_key, key);
    assert.equal((await outbox.list({ restaurantId, userId })).length, 1);
  } finally { db.close(); }
});

test('re-enqueue with the same key and payload returns the original row, but changed payload or user is rejected', async () => {
  const { db, outbox } = await setup();
  try {
    const first = await enqueue(outbox);
    const replay = await enqueue(outbox, { localId: '33333333-3333-4333-8333-333333333333', payload: { items: [{ quantity: 2, menuItemId, notes: 'No onions' }], tableId: null } });
    assert.equal(replay.local_id, first.local_id);
    await assert.rejects(() => enqueue(outbox, { payload: { ...payload, items: [{ menuItemId, quantity: 1 }] } }), /different local user or order payload/);
    await assert.rejects(() => enqueue(outbox, { userId: '44444444-4444-4444-8444-444444444444' }), /different local user or order payload/);
  } finally { db.close(); }
});

test('rejects malformed order payloads and oversized data before writing', async () => {
  const { db, outbox } = await setup();
  try {
    await assert.rejects(() => enqueue(outbox, { payload: { items: [{ menuItemId: 'bad', quantity: 1 }] } }), /UUID/);
    await assert.rejects(() => enqueue(outbox, { payload: { items: [{ menuItemId, quantity: 1000 }] } }), /quantity/);
    await assert.rejects(() => enqueue(outbox, { payload: { items: [] } }), /between 1 and 100/);
    assert.equal((await outbox.list({ restaurantId, userId })).length, 0);
  } finally { db.close(); }
});

test('claims only the active tenant and user and increments the attempt counter', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    assert.equal(await outbox.claimNext({ restaurantId: '55555555-5555-4555-8555-555555555555', userId, leaseToken: lease1, now: 1_000 }), null);
    assert.equal(await outbox.claimNext({ restaurantId, userId: '66666666-6666-4666-8666-666666666666', leaseToken: lease1, now: 1_000 }), null);
    const claimed = await outbox.claimNext({ restaurantId, userId, leaseToken: lease1, now: 1_000 });
    assert.equal(claimed.status, 'syncing');
    assert.equal(claimed.attempt_count, 1);
    assert.equal(claimed.lease_token, lease1);
  } finally { db.close(); }
});

test('does not double-claim a live lease and recovers an expired lease with a new token', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    await outbox.claimNext({ restaurantId, userId, leaseToken: lease1, now: 1_000, leaseMs: 5_000 });
    assert.equal(await outbox.claimNext({ restaurantId, userId, leaseToken: lease2, now: 5_999 }), null);
    const recovered = await outbox.claimNext({ restaurantId, userId, leaseToken: lease2, now: 6_000 });
    assert.equal(recovered.lease_token, lease2);
    assert.equal(recovered.attempt_count, 2);
  } finally { db.close(); }
});

test('serializes concurrent local workers so only one can claim the same order', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    const claims = await Promise.all([
      outbox.claimNext({ restaurantId, userId, leaseToken: lease1, now: 1_000 }),
      outbox.claimNext({ restaurantId, userId, leaseToken: lease2, now: 1_000 })
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await outbox.list({ restaurantId, userId }))[0].attempt_count, 1);
  } finally { db.close(); }
});

test('rejects stale lease acknowledgements and accepts the current lease', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    await outbox.claimNext({ restaurantId, userId, leaseToken: lease1, now: 1_000, leaseMs: 5_000 });
    await outbox.claimNext({ restaurantId, userId, leaseToken: lease2, now: 6_000 });
    await assert.rejects(() => outbox.markSynced({ restaurantId, userId, localId, leaseToken: lease1, serverOrderId, now: 6_001 }), /stale/);
    await outbox.markSynced({ restaurantId, userId, localId, leaseToken: lease2, serverOrderId, now: 6_002 });
    assert.equal((await outbox.list({ restaurantId, userId, status: 'synced' }))[0].server_order_id, serverOrderId);
  } finally { db.close(); }
});

test('applies bounded local retry delays and stops after five attempts', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    const delays = [5_000, 15_000, 30_000, 60_000];
    let now = 1_000;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const lease = [lease1, lease2, '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999'][attempt - 1];
      const claimed = await outbox.claimNext({ restaurantId, userId, leaseToken: lease, now });
      assert.ok(claimed);
      const result = await outbox.scheduleRetry({ restaurantId, userId, localId, leaseToken: lease, errorCode: 'network_error', now });
      if (attempt < 5) {
        assert.equal(result.status, 'pending');
        assert.equal(result.nextAttemptAt, now + delays[attempt - 1]);
        now += delays[attempt - 1];
      } else assert.equal(result.status, 'failed');
    }
    assert.equal((await outbox.list({ restaurantId, userId }))[0].attempt_count, 5);
    assert.equal(await outbox.claimNext({ restaurantId, userId, leaseToken: lease1, now: now + 1 }), null);
  } finally { db.close(); }
});

test('sync sends the persisted body and same idempotency key, then records server order ID', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    let request;
    const result = await syncOneWaiterOrder({
      outbox, restaurantId, userId, leaseToken: lease1,
      apiOrigin: 'https://pos.example.invalid', accessToken: 'memory-only-token', now: 1_000,
      fetchImpl: async (url, options) => {
        request = { url: String(url), options };
        return response(201, { order: { id: serverOrderId } });
      }
    });
    assert.equal(result.status, 'synced');
    assert.equal(request.url, 'https://pos.example.invalid/api/v1/orders');
    assert.equal(request.options.headers['idempotency-key'], key);
    assert.equal(request.options.headers.authorization, 'Bearer memory-only-token');
    assert.deepEqual(JSON.parse(request.options.body), payload);
    const saved = (await outbox.list({ restaurantId, userId, status: 'synced' }))[0];
    assert.equal(saved.server_order_id, serverOrderId);
    assert.equal(saved.payload_json.includes('memory-only-token'), false);
  } finally { db.close(); }
});

test('network errors and server 503 responses are retried; permanent 409 responses fail closed', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    const network = await syncOneWaiterOrder({ outbox, restaurantId, userId, leaseToken: lease1, apiOrigin: 'https://pos.example.invalid', accessToken: 'token', now: 1_000, fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(network.status, 'pending');
    assert.equal(network.nextAttemptAt, 6_000);
    const serverError = await syncOneWaiterOrder({ outbox, restaurantId, userId, leaseToken: lease2, apiOrigin: 'https://pos.example.invalid', accessToken: 'token', now: 6_000, fetchImpl: async () => response(503, {}) });
    assert.equal(serverError.status, 'pending');
    assert.equal(serverError.nextAttemptAt, 21_000);
    const conflict = await syncOneWaiterOrder({ outbox, restaurantId, userId, leaseToken: '77777777-7777-4777-8777-777777777777', apiOrigin: 'https://pos.example.invalid', accessToken: 'token', now: 21_000, fetchImpl: async () => response(409, {}) });
    assert.equal(conflict.status, 'failed');
    assert.equal((await outbox.list({ restaurantId, userId, status: 'failed' }))[0].last_error, 'http_409');
  } finally { db.close(); }
});

test('requires HTTPS outside loopback and never claims a job for an invalid origin', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    await assert.rejects(() => syncOneWaiterOrder({ outbox, restaurantId, userId, leaseToken: lease1, apiOrigin: 'http://pos.example.invalid', accessToken: 'token' }), /HTTPS/);
    assert.equal((await outbox.list({ restaurantId, userId }))[0].status, 'pending');
  } finally { db.close(); }
});

test('401 authentication expiry releases the lease without consuming a retry attempt', async () => {
  const { db, outbox } = await setup();
  try {
    await enqueue(outbox);
    const result = await syncOneWaiterOrder({
      outbox, restaurantId, userId, leaseToken: lease1,
      apiOrigin: 'https://pos.example.invalid', accessToken: 'expired-token', now: 1_000,
      fetchImpl: async () => response(401, { error: 'invalid_or_expired_token' })
    });
    assert.deepEqual(result, { status: 'auth_required', localId });
    const row = (await outbox.list({ restaurantId, userId }))[0];
    assert.equal(row.status, 'pending');
    assert.equal(row.attempt_count, 0);
    assert.equal(row.lease_token, null);
    assert.equal(row.next_attempt_at, 1_000);
    assert.equal(row.last_error, 'authentication_required');
    const reclaimed = await outbox.claimNext({ restaurantId, userId, leaseToken: lease2, now: 1_000 });
    assert.equal(reclaimed.local_id, localId);
    assert.equal(reclaimed.attempt_count, 1);
  } finally { db.close(); }
});

test('order sync retries the same idempotent request at cloud only after local network failure', async () => {
  const db = await createDb();
  const outbox = createWaiterOrderOutbox(db);
  await outbox.initialize();
  await outbox.enqueue({ restaurantId, userId, localId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', payload: { tableId: null, items: [{ menuItemId, quantity: 1 }] }, now: 1000 });
  const visited = [];
  const result = await syncOneWaiterOrder({ outbox, restaurantId, userId, leaseToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', apiOrigins: ['https://local.pos.test', 'https://cloud.pos.test'], accessToken: 'token', now: 1000, fetchImpl: async (url, options) => {
    visited.push({ url: String(url), key: options.headers['idempotency-key'] });
    if (String(url).startsWith('https://local.')) throw new Error('local offline');
    return response(201, { order: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } });
  }});
  assert.equal(result.status, 'synced');
  assert.deepEqual(visited.map(item => item.url), ['https://local.pos.test/api/v1/orders', 'https://cloud.pos.test/api/v1/orders']);
  assert.equal(visited[0].key, visited[1].key);
  db.close();
});
