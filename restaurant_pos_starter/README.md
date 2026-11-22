# Restaurant POS – Development Package

This ZIP contains a working **backend foundation**, not a finished commercial POS. Implemented features are listed in `docs/IMPLEMENTATION_PLAN.md`.

## Current backend capabilities
- PostgreSQL-backed login with scrypt password hashes
- Signed access tokens and role checks
- Master Admin can create restaurants and their first Restaurant Admin transactionally
- Tenant context comes from signed authentication claims, not client-supplied tenant headers
- Transactional order creation using tenant-owned active menu prices (client-supplied prices are ignored)
- Tenant-scoped order list and kitchen/bar preparation ticket APIs with guarded status transitions and bounded keyset pagination

## Quick start
See `docs/IMPLEMENTATION_PLAN.md` for full setup. The API requires PostgreSQL and npm dependencies.

## Verification
Run `cd server && npm test`. Tests use Node's built-in test runner and do not require a database. API integration tests require a configured PostgreSQL database.

## Production warning
No software can honestly be guaranteed “without any errors”. This version has automated unit tests, but it has not yet undergone end-to-end, penetration, load, printer-hardware or offline-recovery testing. Do not use it for live restaurant transactions until those stages are completed.


## Phase 3 update
Master Admin restaurant provisioning and tenant activation controls are implemented. Restaurant Admin endpoints now manage dashboard summaries, service areas, tables, menu categories and menu items. The React admin web app supports sign-in and these management workflows. See `docs/PHASE_3_MASTER_RESTAURANT_ADMIN.md`.

This remains an in-progress POS platform, not a fully production-certified system. See the verification boundaries in the phase document.

## Order workflow update
See `docs/PHASE_4_ORDER_TICKETS.md` for the new order and preparation-ticket API. For a fresh database apply `database/schema.sql`. Apply `database/migrations/002_order_tickets.sql` only if the earlier tables were successfully created; if the earlier schema stopped before creating `order_items`, use a clean development database and the current schema. Back up any existing data before migration.

## Safe order retry update
`POST /api/v1/orders` now requires a tenant-scoped `Idempotency-Key` UUID so a mobile client can safely retry an order after a timeout without creating a duplicate. See `docs/PHASE_6_ORDER_RETRY_SAFETY.md` and apply `database/migrations/003_order_idempotency.sql` to an existing phase-5 database.


## Phase 7 – Printer outbox foundation

Order creation now writes durable kitchen/bar print jobs in the same transaction. See `docs/PHASE_7_PRINT_OUTBOX.md` for claim/ack endpoints, retry semantics and the remaining physical ESC/POS integration work.


## Phase 8 – Print queue operations
Restaurant Admin can review tenant-scoped print jobs, manually requeue failed jobs with a recorded reason, and inspect recovery history. Existing Phase 7 databases must apply migration `005_print_job_operations.sql` after migration 004. This is operational queue management, not physical printer integration.


## Phase 9 – Initial Windows print agent

An initial standalone TCP ESC/POS agent is included in `printer-agent/`. It supports kitchen/bar/other station claims and raw Ethernet/Wi-Fi printers, with strict ASCII-only output and at-least-once delivery semantics. It is not yet a production Windows service and does not support Arabic raster printing, USB/Bluetooth or physical printer status. Read `docs/PHASE_9_WINDOWS_PRINT_AGENT.md` and `printer-agent/README.md` before testing.

## Latest implementation update

See [`docs/PHASE_10_PRINT_RETRY_BACKOFF.md`](docs/PHASE_10_PRINT_RETRY_BACKOFF.md) for the bounded server-side retry schedule and database migration 006.

## Phase 11 – Waiter offline order outbox foundation

`waiter/src/orderOutbox.js` adds an Expo SQLite-compatible durable local order queue. It scopes pending orders to the active restaurant and user, keeps the same server idempotency UUID across retries, uses expiring leases to prevent duplicate local workers, and applies bounded retry delays. See `docs/PHASE_11_WAITER_OFFLINE_OUTBOX.md` for integration guidance and important security limitations. This is not yet a complete Android app or a complete offline-first sync system.


## Phase 12 – Waiter catalog endpoint and offline cache

Authenticated waiters can fetch a tenant-scoped catalog from `GET /api/v1/waiter/catalog`. The waiter SQLite layer stores menu categories/items, service areas, tables and currency/timezone per restaurant, marks stale snapshots for offline browsing, and atomically preserves the previous catalog if a refresh fails. The cache is display data only; the server still validates every submitted order against its current catalog. See `docs/PHASE_12_WAITER_CATALOG_CACHE.md`.

## Waiter Android application (Phase 13)

The `waiter/` directory now contains an initial Expo React Native app. See [`docs/PHASE_13_WAITER_ANDROID_APP.md`](docs/PHASE_13_WAITER_ANDROID_APP.md) for setup, API-origin security requirements, and limitations. The Android application ID remains a placeholder and must be replaced before distribution.

## Phase 14 – Local/cloud endpoint routing and bilingual waiter UI

The waiter app now accepts a local-first endpoint pair (`EXPO_PUBLIC_POS_LOCAL_API_ORIGIN`, then `EXPO_PUBLIC_POS_CLOUD_API_ORIGIN`) and falls back to cloud only on transport/network failure. It retains the legacy single-origin variable for compatibility. The waiter UI has an Arabic/English switch with right-to-left/left-to-right layout and persists the language preference in SecureStore. See `docs/PHASE_14_LOCAL_CLOUD_BILINGUAL_WAITER.md` for the critical requirement that both API origins front the same logical database and share compatible authentication keys. This client configuration does not implement server/database replication.
