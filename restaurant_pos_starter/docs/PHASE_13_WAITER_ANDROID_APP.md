# Phase 13 — Initial Android waiter application

## Implemented

- Initialized an Expo React Native Android application in `waiter/` with an application entry point, Android package placeholder, and Expo configuration.
- Added a small API client for login, current-user validation, and catalog retrieval. It accepts HTTPS origins only, except HTTP loopback for local development; it never accepts a tenant ID from the client as an authorization input.
- Added a SecureStore-backed session adapter. The bearer token and minimal waiter identity are stored in the operating system secure store, not in SQLite. The app re-validates restored sessions through `/api/v1/auth/me`.
- Added an initial Arabic RTL-oriented waiter workflow: login, service-area and table selection, catalog display, cart quantity editing, local order persistence, pending queue display, and manual synchronization.
- Orders are persisted before any network attempt. The existing stable idempotency key is retained for every retry; the server remains authoritative for prices, item activation, table status, and tenant ownership.
- Prevented account switching or logout while the current/previous account has unsynchronized local orders. This avoids orphaning orders under a different user identity on a shared device.
- Changed a `401` synchronization response to release the local lease and return the order to `pending` without consuming a retry attempt. The UI requests re-authentication; the order remains available for the same user to retry.

## Run locally

1. Install Node.js compatible with the Expo SDK and install dependencies with `npm install` inside `waiter/`.
2. Set `EXPO_PUBLIC_POS_API_ORIGIN` to the API origin. Use HTTPS for any non-loopback host. Do not put credentials or tokens in this variable.
3. Start with `npm start`, then launch on an Android emulator or development device using Expo.
4. Configure a real, unique Android application ID before producing a distributable build; the current `com.example.restaurantposwaiter` is only a placeholder.

## Offline and account behavior

- Cached menu and table information is for display only. The UI warns when the snapshot is stale. The server revalidates every order.
- Local order rows are scoped to both restaurant and waiter. A user switch is blocked while the previous identity has any non-synced order rows.
- A `401` does not mark an order permanently failed. The lease is released immediately, the attempt count is restored, and the user must sign in again before retrying.
- Permanent client errors such as `409` remain failed for review; this phase does not yet provide a supervisor recovery workflow for failed order rows.
- SecureStore availability and Android device lock behavior depend on device configuration. No payment credentials are stored.

## Verification

- Added Node tests for API-origin policy, login role validation, bearer-token use, tenant mismatch rejection, safe error handling, and SecureStore session validation.
- Added a regression test proving that an expired session releases an outbox lease without consuming a retry attempt.
- The existing Node SQLite tests continue to cover the local catalog cache and order outbox.

## Not yet verified / not implemented

- Expo dependency installation and Android native build were not run in this environment; there is no Android SDK/emulator here.
- PostgreSQL integration, real device login, real network transitions, Android background synchronization, push updates, and encrypted SQLite remain outstanding.
- No background sync task is registered. The user currently triggers synchronization manually or immediately after saving an order.
- This is the first functional waiter UI, not a complete Android release build or production-ready application.
