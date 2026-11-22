# Restaurant POS implementation status

## Implemented in this ZIP
- Express API bootstrap and PostgreSQL connection pool.
- Password hashing with Node.js scrypt and constant-time password verification.
- Signed HS256 access tokens with expiry checks.
- Login and current-user endpoints.
- Master Admin API to list restaurants and create a restaurant plus its first Restaurant Admin in one database transaction.
- Tenant context is derived from signed token claims; client-supplied restaurant headers are ignored.
- Each authenticated API request re-checks that the account is active and that its role and restaurant still match the token.
- Restaurant Admin API and web screens manage tenants, service areas, tables, menu categories and menu items.
- PostgreSQL schema constraints prevent master users from being assigned to a restaurant and enforce same-restaurant table/area/category relationships.
- Unit tests for password hashing, token validation, tenant isolation and order calculations/ticket routing.

## Not implemented yet (do not treat as production-complete)
- Remaining Restaurant Admin workflows such as staff management, inventory, expenses and detailed reports.
- Waiter Android app, live kitchen/bar display clients, printer agent and physical ESC/POS integration.
- Payments, tax configuration, discounts, refunds, split/merged bills, audit logs.
- Durable offline queue, conflict resolution and sync protocol.
- PostgreSQL row-level security policies, refresh-token sessions, rate limiting, MFA, external security audit and deployment automation. Account deactivation/role changes are re-checked on each API request.
- End-to-end tests against a real PostgreSQL instance and physical printer models.

## Install and run API
1. Install Node.js 20+ and PostgreSQL 15+.
2. `cd server && npm install`
3. Copy `.env.example` to `.env`; set DATABASE_URL and a cryptographically random JWT_SECRET of at least 32 bytes.
4. From project root apply schema: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql`
5. Create the first master admin: `cd server && npm run seed:master -- admin@example.com "use-a-long-unique-password"`
6. Start: `npm start`
7. Test: `npm test`

The schema file is for a fresh database. Do not run it over an existing production database without a reviewed migration and backup.


## Delivery status (updated)
- [x] Authentication foundation and password hashing
- [x] Master Admin: create/list/detail/enable-disable restaurant tenants
- [x] Restaurant Admin: dashboard, service areas, tables, menu categories and menu items
- [x] Role-protected API routes and token-derived tenant scoping
- [x] Unit tests for order domain, password handling, token verification, tenant context and account-session invalidation
- [ ] Full waiter Android app
- [x] Backend order creation and kitchen/bar ticket API
- [ ] Live kitchen/bar display clients and Arabic-capable, production ESC/POS print service
- [ ] Billing, payment, refunds, shifts and accounting
- [ ] Offline-first storage and conflict-safe synchronization
- [ ] Production deployment, monitoring, backup restore drills and external security review

See `docs/PHASE_4_ORDER_TICKETS.md` for the order workflow endpoints and database update instructions.

## Phase 6 delivery update
- [x] Require a client-generated idempotency UUID when creating an order.
- [x] Store the request hash and exact original response in the same transaction as the order.
- [x] Scope idempotency keys by the authenticated restaurant and reject reuse with a different order payload.
- [x] Add fresh-schema DDL and additive migration `003_order_idempotency.sql`.
- [x] Add deterministic request-hash unit tests.
- [ ] Add PostgreSQL integration tests for concurrent retries, rollback recovery and cross-tenant key isolation.
- [ ] Implement the Android client's durable outbox so it persists and reuses the same key across reconnects.

See `docs/PHASE_6_ORDER_RETRY_SAFETY.md`. This is a server-side prerequisite for offline retry, not a complete offline synchronization implementation.


## Phase 7 delivery update
- [x] Persist one tenant-scoped print outbox job per order preparation group in the order transaction.
- [x] Add atomic leased job claims and claim-token acknowledgements/failures.
- [x] Enforce kitchen/bar station scope on print-job claims.
- [ ] Add PostgreSQL integration tests for concurrent claims, lease recovery and rollback.
- [ ] Implement local ESC/POS print bridge and validate against actual printer models.

See `docs/PHASE_7_PRINT_OUTBOX.md`.


## Phase 8 delivery update
- [x] Add tenant-scoped Restaurant Admin print-job listing with validated filters and bounded page size.
- [x] Add manual requeue for exhausted jobs with a required operator reason.
- [x] Record manual requeue events transactionally with same-tenant actor/job foreign keys.
- [ ] Add PostgreSQL integration tests for manual requeue, event rollback and cross-tenant denial.
- [ ] Implement and test the local ESC/POS print bridge against target printer models.

See `docs/PHASE_8_PRINT_OPERATIONS.md`.


## Phase 9 delivery update
- [x] Add a standalone Windows-compatible TCP print-agent worker for configured station groups.
- [x] Add conservative ESC/POS ticket encoding, bounded config validation and fake-transport tests.
- [x] Snapshot the dining table display name into new print jobs.
- [ ] Add Arabic raster printing, USB/Bluetooth/spooler support, printer status and a managed Windows Service installer.
- [ ] Add secure token renewal and PostgreSQL/real-printer integration tests.

See `docs/PHASE_9_WINDOWS_PRINT_AGENT.md`.

## Phase 11 delivery update
- [x] Add an Expo SQLite-compatible durable waiter order outbox.
- [x] Persist the same tenant-scoped idempotency key and exact canonical order request across reconnect retries.
- [x] Scope local claims to the active restaurant and user; reject stale lease acknowledgements.
- [x] Add bounded local retry policy and permanent-failure handling for non-retryable HTTP errors.
- [x] Add actual SQLite unit tests using Node's built-in SQLite driver.
- [ ] Build the Android/Expo UI, sign-in, menu/table cache, and connectivity/background sync integration.
- [ ] Encrypt local sensitive data or establish a reviewed device-level data protection policy.
- [ ] Test on Android devices and exercise PostgreSQL/API integration during network loss and concurrent retries.

See `docs/PHASE_11_WAITER_OFFLINE_OUTBOX.md`. The local queue is a foundation for offline order capture, not a complete offline POS client.


## Phase 12 delivery update
- [x] Add authenticated, tenant-scoped waiter catalog endpoint for currency, menu, service areas and tables.
- [x] Add bounded validation and atomic tenant-scoped SQLite catalog snapshot cache.
- [x] Keep stale cached catalog available for offline display and preserve prior snapshot after refresh failure.
- [x] Serialize catalog and outbox transactions when sharing one SQLite connection.
- [ ] Build the Expo/Android UI and integrate sign-in, catalog refresh, connectivity observation and background synchronization.
- [ ] Add PostgreSQL route integration tests and Android emulator/physical-device tests.
- [ ] Implement reviewed local database encryption/device data-protection and logout cleanup policy.

See `docs/PHASE_12_WAITER_CATALOG_CACHE.md`.

## Phase 14 delivery update
- [x] Add validated local-first and cloud-fallback API origin configuration while retaining legacy single-origin configuration.
- [x] Restrict fallback to transport/network failures; do not switch endpoints after HTTP responses such as authentication, authorization, conflict or server errors.
- [x] Reuse the same persisted idempotency key when retrying an order through the cloud endpoint after local network failure.
- [x] Add Arabic/English waiter UI translations, direction-aware layout, an in-app language switch, and SecureStore language preference.
- [ ] Provision and test local/cloud API deployments against the same logical tenant database and shared authentication signing keys.
- [ ] Implement server-to-server replication if local and cloud servers must accept independent writes into separate databases.
- [ ] Build and test the Expo app on Android devices, and validate trusted HTTPS certificates for the local Wi-Fi endpoint.

See `docs/PHASE_14_LOCAL_CLOUD_BILINGUAL_WAITER.md`. Client endpoint fallback is not database replication or proof of full local/cloud offline operation.
