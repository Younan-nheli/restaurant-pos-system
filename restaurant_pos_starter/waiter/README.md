# Waiter Android app — initial Expo UI and offline core

This folder now contains an initial Expo React Native Android application plus the local order outbox, tenant-scoped catalog cache, API client, and secure session adapter.

## Current capability

- Arabic waiter login flow using `/api/v1/auth/login` and `/api/v1/auth/me`.
- Store the bearer token and minimal waiter identity through Expo SecureStore; credentials and tokens are not stored in SQLite.
- Browse the cached restaurant catalog, choose a service area/table, add items to a cart, and persist orders locally before network submission.
- Reuse one stable idempotency UUID for every retry of a locally saved order.
- Display pending/synced/failed local orders and trigger manual synchronization.
- Keep the queue scoped to the authenticated restaurant and waiter; block account switching/logout while non-synced orders remain.
- Release a local order lease on HTTP 401 without consuming an attempt, then require the same waiter to sign in again.
- Require HTTPS for non-loopback API origins. Offline cached prices and table states are display-only; the server remains authoritative.

## Start the app

```bash
cd waiter
npm install
# Set EXPO_PUBLIC_POS_API_ORIGIN to the API HTTPS origin in your shell.
npm start
```

Use `npm run android` to launch on an available Android emulator. Replace `com.example.restaurantposwaiter` with the organization's unique Android application ID before producing a distributable build.

## Tests

```bash
npm test
```

The Node test suite uses SQLite in memory and requires Node.js 22.5+. It tests the offline cache/outbox, API validation, secure session adapter, and retry behavior. It does not build or launch the Expo native application.

## Not implemented or not verified

- Automatic background synchronization and a connectivity observer.
- Encrypted SQLite database and a reviewed device data-retention policy.
- Android SDK build, emulator/device tests, PostgreSQL integration, and real network-transition tests.
- KDS/Bar Display screens, billing/payment/split bills, and full waiter order-status updates.
- The current UI is an initial functional workflow, not a production release.

## Local + cloud connection mode (Phase 14)

The app supports a local-first endpoint list with cloud network fallback. Configure both origins in the build environment:

```bash
EXPO_PUBLIC_POS_LOCAL_API_ORIGIN=https://pos.local.example
EXPO_PUBLIC_POS_CLOUD_API_ORIGIN=https://pos.example.com
```

The local endpoint is tried first. The cloud endpoint is attempted only if the local request fails at the network/transport layer. HTTP responses (including 401, 403, 409 and 5xx) are returned as-is; the app does not silently switch environments after an application response. Order retries reuse the same idempotency key at either origin.

**Critical deployment requirement:** the local and cloud API origins must represent the same logical POS environment: same tenant database/state and compatible shared authentication signing keys. This client fallback is not database replication and does not create synchronization between two independent databases. Do not configure unrelated local and cloud databases as a pair. If the restaurant needs independent local writes during an internet outage, a separate server-to-server replication/sync service must be implemented and tested before production use.

For local development, `http://localhost` is allowed. A local server reached over Wi-Fi must use HTTPS with a certificate trusted by the Android device; plain HTTP to a LAN IP is deliberately rejected. The previous `EXPO_PUBLIC_POS_API_ORIGIN` remains supported as a single-origin compatibility setting.

## Language

The waiter UI now includes an Arabic/English switch. Arabic uses right-aligned text and reversed row layout; English uses left-aligned text and normal row layout. Product and service-area names are rendered exactly as stored in the restaurant catalog and are not machine-translated.
