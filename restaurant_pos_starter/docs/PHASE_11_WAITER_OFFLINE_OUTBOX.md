# Phase 11 — Waiter offline order outbox foundation

## Implemented

- Added `waiter/src/orderOutbox.js`, a storage layer compatible with the asynchronous API exposed by `expo-sqlite` (`execAsync`, `runAsync`, `getFirstAsync`, `getAllAsync`, `withTransactionAsync`).
- Added a durable SQLite table with tenant/user ownership, a stable idempotency UUID, canonical request JSON, retry state, lease token and expiry, and server order ID.
- Order payloads are reduced to the fields accepted by `POST /api/v1/orders` (`tableId`, `menuItemId`, `quantity`, and optional notes). Client names, prices, and routing values are never persisted for submission.
- Enqueue is idempotent locally: the same tenant/key/user/payload returns the original row; a key reused for a different user or payload is rejected.
- Claims are scoped to the currently authenticated restaurant and user. Expired leases can be recovered, while stale workers cannot acknowledge a newer lease.
- Sync reuses the exact stored idempotency key in the `Idempotency-Key` HTTP header. Access tokens are supplied in memory and are not written to SQLite.
- Network/5xx/408/429 errors use bounded 5/15/30/60-second retry delays and a five-attempt limit. Other 4xx responses are marked failed for operator/user review rather than retried indefinitely.
- API origins require HTTPS except for loopback development.

## Minimal Expo SQLite integration

```js
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { createWaiterOrderOutbox, syncOneWaiterOrder } from './src/orderOutbox.js';

const db = await SQLite.openDatabaseAsync('waiter.db');
const outbox = createWaiterOrderOutbox(db);
await outbox.initialize();

// Generate both UUIDs with expo-crypto when the user taps Send.
await outbox.enqueue({
  restaurantId: session.restaurantId,
  userId: session.userId,
  localId: Crypto.randomUUID(),
  idempotencyKey: Crypto.randomUUID(),
  payload: { tableId: selectedTableId ?? null, items: cart.map(x => ({
    menuItemId: x.menuItemId, quantity: x.quantity, ...(x.notes ? { notes: x.notes } : {})
  })) }
});

// Call while online and while this same user/restaurant session is active.
await syncOneWaiterOrder({
  outbox, restaurantId: session.restaurantId, userId: session.userId,
  leaseToken: Crypto.randomUUID(), apiOrigin: POS_API_ORIGIN,
  accessToken: session.accessToken
});
```

Run the sync function repeatedly while online; it sends at most one due order per call. Do not generate a new idempotency key when retrying an existing row.

## Verification

- `cd waiter && npm test` runs eleven tests against an actual in-memory SQLite database using Node's built-in `node:sqlite` adapter.
- These tests cover durable rows, canonical payloads, duplicate enqueue, tenant/user scoping, leases, stale acknowledgements, bounded retries, stable idempotency headers, and permanent HTTP failures.
- The test command currently requires Node.js 22.5+ because it uses Node's built-in SQLite test driver. The module itself targets the Expo SQLite async API and does not import Node APIs.

## Important limitations

- This is the offline order persistence/sync core, not the Android application UI. There is no sign-in screen, menu/table cache, background task registration, or connectivity observer yet.
- Expo integration has not been run on an Android emulator or physical device in this environment.
- SQLite contents are not encrypted by this phase. Do not store access tokens, passwords, payment data, or other secrets in the outbox. Device encryption/secure storage and account logout policy still need implementation and review.
- A local order marked `failed` requires an explicit user/admin recovery workflow; this phase intentionally does not silently change the request or mint a replacement idempotency key.
- PostgreSQL integration, concurrent mobile-device testing, and offline/online network-transition testing remain outstanding.
