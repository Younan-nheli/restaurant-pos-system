# Phase 8 – Print queue operations and manual recovery

## Implemented

- Restaurant Admin can inspect print jobs for their own restaurant with optional `status`, `group`, and `limit` filters (`limit` defaults to 50 and is capped at 100).
- Kitchen and Bar accounts do not have access to the operational listing or recovery endpoints; they retain only their station-scoped claim/complete/fail workflow.
- A Restaurant Admin can manually requeue a job only when its status is `failed`. The request must include a non-empty reason of at most 500 characters.
- Manual requeue resets the automatic attempt counter and clears the prior lease/error fields so the job can be claimed again. It does not alter the original order or ticket snapshot.
- Every manual requeue is written to `print_job_events` in the same transaction as the status change. The actor and print job are both constrained to the same restaurant by composite foreign keys.
- Restaurant Admin can inspect the manual-requeue history for a job.

## Endpoints

`GET /api/v1/print-jobs?status=failed&group=kitchen&limit=50`

`POST /api/v1/print-jobs/<job-id>/requeue` with JSON body `{ "reason": "Printer paper replaced; retry approved" }`.

`GET /api/v1/print-jobs/<job-id>/events`

All endpoints require a current authenticated Restaurant Admin session. Tenant identity is derived from the verified account and never accepted from request parameters.

## Database update

- Fresh installations receive `print_job_events` from `database/schema.sql`.
- Existing Phase 7 installations must apply `database/migrations/005_print_job_operations.sql` once after migration 004. Back up and verify the backup first.

## Limits

- Unit tests cover the manual-requeue authorization policy. PostgreSQL route integration tests, concurrency tests, and migration execution have not yet been run because PostgreSQL tooling/server is not available in this development environment.
- This is queue administration only. It does not print paper and does not provide exactly-once physical output.
