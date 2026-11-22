# Phase 10 — Print retry backoff

## What changed

- Print jobs now have a server-controlled `available_at` timestamp.
- A reported printer failure schedules the next automatic attempt after 5, 15, 30, then 60 seconds for attempts 1–4.
- Attempt 5 remains terminal and is moved to `failed`, preserving the existing five-attempt limit.
- Claim queries only select pending jobs whose `available_at` has arrived. Expired worker leases remain reclaimable after their lease timeout, because a crashed worker has not reported a known failure.
- Manual Restaurant Admin requeue makes a failed job immediately eligible again and resets its attempt counter, as before.
- The delay is selected by SQL from the persisted attempt count; the client cannot shorten it by sending a custom delay or attempt count.
- The retry index remains tenant- and station-scoped.

## Database update

For an existing Phase 9 database, apply `database/migrations/006_print_retry_backoff.sql` after migration 005. For a fresh database, use the updated `database/schema.sql`.

Take and verify a database backup before applying migrations in a real environment. This phase has not been run against PostgreSQL in the development environment.

## Verification

The retry-policy unit tests verify the intended bounded schedule and reject invalid attempt counts. The API query changes are syntax-reviewed but have not been exercised against PostgreSQL. Existing server and printer-agent tests use local Node.js tests and fake dependencies; they do not prove real printer output or database locking behavior.

## Operational behavior

A worker-reported failure on attempts 1–4 is not immediately claimable again. The server waits 5, 15, 30, or 60 seconds respectively. If a worker crashes without reporting, the existing 120-second lease timeout governs recovery instead. The five-attempt terminal limit is unchanged.
