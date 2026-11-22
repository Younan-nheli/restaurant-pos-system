# Phase 12 — Waiter catalog API and tenant-scoped offline cache

## Implemented

- Added `GET /api/v1/waiter/catalog`, available to authenticated `waiter` and `restaurant_admin` roles. The restaurant ID is taken only from the authenticated tenant context; client-supplied tenant IDs are not accepted.
- The endpoint returns the active restaurant's currency/timezone, menu categories, active menu items with exact decimal-string prices and routing groups, service areas, and tables with current statuses. All queries are scoped to the authenticated restaurant.
- Added `waiter/src/catalogCache.js`, an Expo SQLite-compatible local snapshot store. It validates the response restaurant ID, UUIDs, category/table/area relationships, price strings, routing groups, status values, and bounded collection sizes before writing.
- Catalog replacement is atomic. A failed refresh rolls back and preserves the previous snapshot. Cached catalogs remain available offline and are marked stale based on a caller-supplied freshness window.
- Cache reads, writes and clearing are scoped by restaurant ID. The cache does not store access tokens or user credentials.
- Added `sqliteTransactions.js` so catalog refresh and order-outbox writes serialize transactions when they share one SQLite connection.

## API

`GET /api/v1/waiter/catalog`

Example response shape:

```json
{
  "restaurantId": "<authenticated-restaurant-uuid>",
  "serverTime": "2026-11-19T17:00:00.000Z",
  "restaurant": { "currency": "IQD", "timezone": "Asia/Baghdad" },
  "categories": [{ "id": "<uuid>", "name": "Meals", "sortOrder": 1 }],
  "items": [{ "id": "<uuid>", "categoryId": "<uuid>", "name": "Rice", "price": "1250.00", "routingGroup": "kitchen", "active": true }],
  "serviceAreas": [{ "id": "<uuid>", "name": "Main Hall" }],
  "tables": [{ "id": "<uuid>", "serviceAreaId": "<uuid>", "serviceAreaName": "Main Hall", "tableName": "T1", "status": "available" }]
}
```

## Expo SQLite integration

```js
import * as SQLite from 'expo-sqlite';
import { createWaiterCatalogCache } from './src/catalogCache.js';

const db = await SQLite.openDatabaseAsync('waiter.db');
const catalogCache = createWaiterCatalogCache(db);
await catalogCache.initialize();

// While online, fetch with the in-memory session token and save the response.
const response = await fetch(`${POS_API_ORIGIN}/api/v1/waiter/catalog`, {
  headers: { authorization: `Bearer ${session.accessToken}` }
});
if (!response.ok) throw new Error(`Catalog refresh failed: ${response.status}`);
const snapshot = await response.json();
await catalogCache.replaceSnapshot({
  restaurantId: session.restaurantId,
  snapshot
});

// Offline browsing: stale snapshots are returned with stale=true, not discarded.
const cached = await catalogCache.getSnapshot({ restaurantId: session.restaurantId });
```

Use the cached catalog for offline display only. Prices, item activation, table availability and tenant ownership must always be revalidated by the server when an order is synchronized. The order API already uses the authenticated tenant and current server catalog; client-cached prices are not authoritative.

## Verification

- `cd waiter && npm test` runs the local SQLite tests for cache persistence, stale-state reporting, cross-tenant rejection, relationship validation, atomic replacement, selective clearing, transaction serialization with the order outbox, and the existing offline order synchronization tests.
- The backend route was syntax-checked but not integration-tested against PostgreSQL in this environment.

## Limitations

- This is catalog API plus storage, not a complete Android UI. No Expo project, sign-in screens, cart UI, network observer, or background sync task has been added.
- No incremental catalog version or conflict-resolution protocol exists yet; each refresh replaces the full bounded snapshot.
- Offline cached table status can become stale. The server remains authoritative and rejects invalid/disabled tables.
- SQLite data is not encrypted by this phase. Do not store credentials, payment data or access tokens in the catalog cache or order outbox.
- PostgreSQL integration tests, Android emulator/device tests, and network-transition tests remain outstanding.
