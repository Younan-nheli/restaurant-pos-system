# Phase 7 – Durable kitchen/bar print-job outbox

## Implemented

- Creating an order now creates one durable print job per routing group represented in the persisted order items.
- Print-job payloads are snapshots of server-persisted item names, quantities, prices, notes, table and currency. Client-supplied catalog fields are never used to construct print payloads.
- Print jobs are inserted in the same PostgreSQL transaction as the order, order lines, table occupancy update and idempotency response. A failed order transaction therefore cannot leave orphan print jobs; a successful retry cannot create duplicate jobs because the original response is replayed and the table has a tenant/order/group unique constraint.
- `POST /api/v1/print-jobs/claim` atomically leases one pending job for 120 seconds using `FOR UPDATE SKIP LOCKED`. Expired leases can be reclaimed after a worker crash.
- `POST /api/v1/print-jobs/:id/complete` acknowledges a job using its claim token.
- `POST /api/v1/print-jobs/:id/fail` records a bounded error and requeues explicit printer failures up to five attempts; after the fifth attempt the job becomes `failed` for operator review. Expired worker leases are also retried, but a lease that expires on the fifth attempt is moved to `failed` on the next claim request.
- The claim/complete/fail APIs are tenant-scoped. Kitchen users can claim only kitchen jobs, bar users only bar jobs, and Restaurant Admin can claim all configured groups. A claim token is required to acknowledge or fail a lease.

## API outline

```http
POST /api/v1/print-jobs/claim
Authorization: Bearer <access-token>
Content-Type: application/json

{ "group": "kitchen" }
```

A successful claim returns a `job` including `id`, `payload`, `attempt_count`, `claim_token` and `claimed_until`. No available job returns HTTP 204.

```http
POST /api/v1/print-jobs/<job-id>/complete
Authorization: Bearer <access-token>
Content-Type: application/json

{ "claimToken": "<claim-token>" }
```

A worker reports a printer error with `POST /api/v1/print-jobs/<job-id>/fail`, sending `claimToken` and an `error` string up to 500 characters.

## Delivery guarantees and limitations

- The database outbox provides durable, at-least-once delivery to a future local print bridge. It does not guarantee exactly-once paper output: if a printer physically prints and the worker crashes before acknowledging, the lease expires and the same job can be printed again.
- No ESC/POS encoder, Windows/Linux print bridge, USB/Bluetooth/TCP printer driver, printer discovery, or physical printer test is included in this phase.
- Do not mark a job complete until the local print bridge has confirmed the printer write according to its device-specific policy.
- Fresh databases receive the table from `database/schema.sql`. Existing phase-6 databases must apply `database/migrations/004_print_job_outbox.sql` once after migration 003, with a verified backup first.
- PostgreSQL integration tests are still required for concurrent claims, lease expiry, tenant isolation and transactional rollback. Local unit tests cover payload construction and station authorization only.
