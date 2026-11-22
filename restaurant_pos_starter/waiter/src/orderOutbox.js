import { withSerializedTransaction } from './sqliteTransactions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = Object.freeze([5_000, 15_000, 30_000, 60_000]);

export const WAITER_OUTBOX_SCHEMA = `
CREATE TABLE IF NOT EXISTS waiter_order_outbox (
  local_id TEXT PRIMARY KEY NOT NULL,
  restaurant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','syncing','synced','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  server_order_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (restaurant_id, idempotency_key),
  CHECK (
    (status = 'syncing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR
    (status <> 'syncing' AND lease_token IS NULL AND lease_until IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS waiter_outbox_due_idx
  ON waiter_order_outbox (restaurant_id, user_id, status, next_attempt_at, created_at);
`;

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError(`${field} must be a UUID`);
  return value.toLowerCase();
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function canonicalize(value, depth = 0) {
  if (depth > 20) throw new TypeError('Order payload is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Order payload contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => canonicalize(item, depth + 1));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key], depth + 1)]));
  }
  throw new TypeError('Order payload contains an unsupported value');
}

function normalizeOrderPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) {
    throw new TypeError('Order payload must contain between 1 and 100 items');
  }
  const tableId = payload.tableId == null ? null : requireUuid(payload.tableId, 'tableId');
  const items = payload.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`items[${index}] is invalid`);
    const menuItemId = requireUuid(item.menuItemId, `items[${index}].menuItemId`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
      throw new TypeError(`items[${index}].quantity must be between 1 and 999`);
    }
    if (item.notes !== undefined && item.notes !== null &&
        (typeof item.notes !== 'string' || item.notes.length > 500)) {
      throw new TypeError(`items[${index}].notes must be at most 500 characters`);
    }
    return {
      menuItemId,
      quantity: item.quantity,
      ...(typeof item.notes === 'string' ? { notes: item.notes } : {})
    };
  });
  return canonicalize({ tableId, items });
}

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload: JSON.parse(row.payload_json)
  };
}

function safeErrorCode(value) {
  const code = typeof value === 'string' ? value : 'sync_error';
  return code.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || 'sync_error';
}

function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('apiOrigin must be an absolute HTTP(S) origin'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol !== 'https:' && !loopback) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('apiOrigin must be an HTTPS origin (HTTP is allowed only for loopback development)');
  }
  return url.origin;
}

export function createWaiterOrderOutbox(db) {
  for (const method of ['execAsync', 'runAsync', 'getFirstAsync', 'getAllAsync', 'withTransactionAsync']) {
    if (typeof db?.[method] !== 'function') throw new TypeError(`SQLite database must implement ${method}()`);
  }

  function inTransaction(callback) {
    return withSerializedTransaction(db, callback);
  }

  async function initialize() {
    await db.execAsync(WAITER_OUTBOX_SCHEMA);
  }

  async function enqueue({ restaurantId, userId, localId, idempotencyKey, payload, now = Date.now() }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    userId = requireUuid(userId, 'userId');
    localId = requireUuid(localId, 'localId');
    idempotencyKey = requireUuid(idempotencyKey, 'idempotencyKey');
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be a non-negative integer timestamp');
    const payloadJson = JSON.stringify(normalizeOrderPayload(payload));
    if (utf8ByteLength(payloadJson) > 64 * 1024) throw new RangeError('Order payload exceeds 64 KB');

    return inTransaction(async () => {
      await db.runAsync(
        `INSERT INTO waiter_order_outbox
          (local_id,restaurant_id,user_id,idempotency_key,payload_json,status,attempt_count,
           next_attempt_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'pending',0,?,?,?)
         ON CONFLICT (restaurant_id,idempotency_key) DO NOTHING`,
        localId, restaurantId, userId, idempotencyKey, payloadJson, now, now, now);
      const existing = await db.getFirstAsync(
        `SELECT * FROM waiter_order_outbox WHERE restaurant_id=? AND idempotency_key=?`,
        restaurantId, idempotencyKey);
      if (!existing) throw new Error('Outbox local ID already exists or insert was not persisted');
      if (existing.user_id !== userId || existing.payload_json !== payloadJson) {
        throw new Error('Idempotency key already belongs to a different local user or order payload');
      }
      return parseRow(existing);
    });
  }

  async function claimNext({ restaurantId, userId, leaseToken, now = Date.now(), leaseMs = 60_000 }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    userId = requireUuid(userId, 'userId');
    leaseToken = requireUuid(leaseToken, 'leaseToken');
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 300_000) {
      throw new TypeError('Invalid outbox clock or lease duration');
    }

    return inTransaction(async () => {
      await db.runAsync(
        `UPDATE waiter_order_outbox
         SET status='failed',lease_token=NULL,lease_until=NULL,
             last_error=COALESCE(last_error,'lease_expired_after_max_attempts'),updated_at=?
         WHERE restaurant_id=? AND user_id=? AND status='syncing'
           AND lease_until<=? AND attempt_count>=?`,
        now, restaurantId, userId, now, MAX_ATTEMPTS);
      const candidate = await db.getFirstAsync(
        `SELECT local_id FROM waiter_order_outbox
         WHERE restaurant_id=? AND user_id=? AND attempt_count<?
           AND ((status='pending' AND next_attempt_at<=?)
             OR (status='syncing' AND lease_until<=?))
         ORDER BY created_at ASC,local_id ASC LIMIT 1`,
        restaurantId, userId, MAX_ATTEMPTS, now, now);
      if (!candidate) return null;
      const updated = await db.runAsync(
        `UPDATE waiter_order_outbox
         SET status='syncing',lease_token=?,lease_until=?,attempt_count=attempt_count+1,updated_at=?
         WHERE local_id=? AND restaurant_id=? AND user_id=? AND attempt_count<?
           AND ((status='pending' AND next_attempt_at<=?)
             OR (status='syncing' AND lease_until<=?))`,
        leaseToken, now + leaseMs, now, candidate.local_id, restaurantId, userId, MAX_ATTEMPTS, now, now);
      if (updated.changes !== 1) return null;
      return parseRow(await db.getFirstAsync(
        `SELECT * FROM waiter_order_outbox WHERE local_id=? AND restaurant_id=? AND user_id=?`,
        candidate.local_id, restaurantId, userId));
    });
  }

  async function markSynced({ restaurantId, userId, localId, leaseToken, serverOrderId, now = Date.now() }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    userId = requireUuid(userId, 'userId');
    localId = requireUuid(localId, 'localId');
    leaseToken = requireUuid(leaseToken, 'leaseToken');
    serverOrderId = requireUuid(serverOrderId, 'serverOrderId');
    const result = await db.runAsync(
      `UPDATE waiter_order_outbox
       SET status='synced',lease_token=NULL,lease_until=NULL,server_order_id=?,last_error=NULL,updated_at=?
       WHERE local_id=? AND restaurant_id=? AND user_id=? AND status='syncing' AND lease_token=?`,
      serverOrderId, now, localId, restaurantId, userId, leaseToken);
    if (result.changes !== 1) throw new Error('Outbox lease is stale; synced acknowledgement was rejected');
    return true;
  }

  async function scheduleRetry({ restaurantId, userId, localId, leaseToken, errorCode = 'network_error', now = Date.now() }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    userId = requireUuid(userId, 'userId');
    localId = requireUuid(localId, 'localId');
    leaseToken = requireUuid(leaseToken, 'leaseToken');
    const code = safeErrorCode(errorCode);
    return inTransaction(async () => {
      const row = await db.getFirstAsync(
        `SELECT attempt_count FROM waiter_order_outbox
         WHERE local_id=? AND restaurant_id=? AND user_id=? AND status='syncing' AND lease_token=?`,
        localId, restaurantId, userId, leaseToken);
      if (!row) throw new Error('Outbox lease is stale; retry update was rejected');
      const attempts = Number(row.attempt_count);
      const terminal = attempts >= MAX_ATTEMPTS;
      const delay = terminal ? 0 : RETRY_DELAYS_MS[attempts - 1];
      await db.runAsync(
        `UPDATE waiter_order_outbox
         SET status=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,last_error=?,updated_at=?
         WHERE local_id=? AND restaurant_id=? AND user_id=? AND status='syncing' AND lease_token=?`,
        terminal ? 'failed' : 'pending', now + delay, code, now,
        localId, restaurantId, userId, leaseToken);
      return { status: terminal ? 'failed' : 'pending', attemptCount: attempts, nextAttemptAt: now + delay };
    });
  }

  async function releaseForAuthentication({ restaurantId, userId, localId, leaseToken, now = Date.now() }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    userId = requireUuid(userId, 'userId');
    localId = requireUuid(localId, 'localId');
    leaseToken = requireUuid(leaseToken, 'leaseToken');
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be a non-negative integer timestamp');
    const result = await db.runAsync(
      `UPDATE waiter_order_outbox
       SET status='pending',lease_token=NULL,lease_until=NULL,
           attempt_count=CASE WHEN attempt_count>0 THEN attempt_count-1 ELSE 0 END,
           next_attempt_at=?,last_error='authentication_required',updated_at=?
       WHERE local_id=? AND restaurant_id=? AND user_id=? AND status='syncing' AND lease_token=?`,
      now, now, localId, restaurantId, userId, leaseToken);
    if (result.changes !== 1) throw new Error('Outbox lease is stale; authentication release was rejected');
    return true;
  }

  async function markPermanentFailure({ restaurantId, userId, localId, leaseToken, errorCode, now = Date.now() }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    userId = requireUuid(userId, 'userId');
    localId = requireUuid(localId, 'localId');
    leaseToken = requireUuid(leaseToken, 'leaseToken');
    const result = await db.runAsync(
      `UPDATE waiter_order_outbox
       SET status='failed',lease_token=NULL,lease_until=NULL,last_error=?,updated_at=?
       WHERE local_id=? AND restaurant_id=? AND user_id=? AND status='syncing' AND lease_token=?`,
      safeErrorCode(errorCode), now, localId, restaurantId, userId, leaseToken);
    if (result.changes !== 1) throw new Error('Outbox lease is stale; failure update was rejected');
    return true;
  }

  async function list({ restaurantId, userId, status, limit = 100 }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    userId = requireUuid(userId, 'userId');
    if (status !== undefined && !['pending', 'syncing', 'synced', 'failed'].includes(status)) throw new TypeError('Invalid outbox status');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError('limit must be between 1 and 200');
    const rows = await db.getAllAsync(
      `SELECT * FROM waiter_order_outbox
       WHERE restaurant_id=? AND user_id=? AND (? IS NULL OR status=?)
       ORDER BY created_at DESC,local_id DESC LIMIT ?`,
      restaurantId, userId, status ?? null, status ?? null, limit);
    return rows.map(parseRow);
  }

  return Object.freeze({ initialize, enqueue, claimNext, markSynced, scheduleRetry, releaseForAuthentication, markPermanentFailure, list });
}

/**
 * Sends at most one persisted order. The same idempotency key is reused for every
 * retry; access tokens are passed in memory and are never stored in SQLite.
 */
export async function syncOneWaiterOrder({
  outbox, restaurantId, userId, leaseToken, apiOrigin, apiOrigins, accessToken,
  fetchImpl = fetch, now, clock = Date.now
}) {
  const origins = apiOrigins ? [...new Set(apiOrigins.map(validateOrigin))] : [validateOrigin(apiOrigin)];
  if (!origins.length) throw new TypeError('At least one API origin is required');
  if (typeof accessToken !== 'string' || accessToken.length < 1 || accessToken.length > 8192) {
    throw new TypeError('A valid in-memory access token is required');
  }
  const job = await outbox.claimNext({ restaurantId, userId, leaseToken, now: now ?? clock() });
  if (!job) return { status: 'idle' };

  let response;
  for (const origin of origins) {
    try {
      response = await fetchImpl(new URL('/api/v1/orders', `${origin}/`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'idempotency-key': job.idempotency_key
        },
        body: job.payload_json
      });
      break;
    } catch {
      // Retry the same idempotent payload against the next origin only on network failure.
    }
  }
  if (!response) {
    const retry = await outbox.scheduleRetry({ restaurantId, userId, localId: job.local_id, leaseToken, errorCode: 'network_error', now: now ?? clock() });
    return { status: retry.status, localId: job.local_id, ...retry };
  }

  if (response.status >= 200 && response.status < 300) {
    let data;
    try { data = await response.json(); } catch { data = null; }
    const serverOrderId = data?.order?.id;
    if (!UUID.test(serverOrderId || '')) {
      const retry = await outbox.scheduleRetry({ restaurantId, userId, localId: job.local_id, leaseToken, errorCode: 'invalid_server_response', now: now ?? clock() });
      return { status: retry.status, localId: job.local_id, ...retry };
    }
    await outbox.markSynced({ restaurantId, userId, localId: job.local_id, leaseToken, serverOrderId, now: now ?? clock() });
    return { status: 'synced', localId: job.local_id, serverOrderId };
  }

  if (response.status === 401) {
    await outbox.releaseForAuthentication({ restaurantId, userId, localId: job.local_id, leaseToken, now: now ?? clock() });
    return { status: 'auth_required', localId: job.local_id };
  }

  if ((response.status >= 400 && response.status < 500) && ![408, 429].includes(response.status)) {
    await outbox.markPermanentFailure({ restaurantId, userId, localId: job.local_id, leaseToken, errorCode: `http_${response.status}`, now: now ?? clock() });
    return { status: 'failed', localId: job.local_id, errorCode: `http_${response.status}` };
  }

  const retry = await outbox.scheduleRetry({ restaurantId, userId, localId: job.local_id, leaseToken, errorCode: `http_${response.status}`, now: now ?? clock() });
  return { status: retry.status, localId: job.local_id, ...retry };
}
