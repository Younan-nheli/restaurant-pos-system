# Phase 6 – Safe order retries (idempotency foundation)

## Implemented

- `POST /api/v1/orders` now requires an `Idempotency-Key` header containing a UUID.
- The key is unique within the authenticated restaurant, not globally. The tenant ID comes from the verified account context; a client cannot choose another tenant's namespace.
- The server hashes the meaningful request fields (`tableId`, ordered menu item IDs, quantities and notes). Client-supplied names, prices and routing groups are excluded because the server ignores them and loads trusted values from that restaurant's catalog.
- The idempotency reservation, order, order lines and stored response are committed in one database transaction.
- Retrying the same key with the same request returns HTTP `200`, the original response body and `Idempotency-Replayed: true`; it does not create a second order.
- Reusing a key with a different meaningful request returns HTTP `409` (`idempotency_key_reused_with_different_request`).
- A new attempt after a rolled-back transaction can safely use the same key because the reservation also rolls back.

## Request example

```http
POST /api/v1/orders
Authorization: Bearer <access-token>
Idempotency-Key: 7c2a9f6d-4d9e-4b62-9b0f-2e4f90b2e8a1
Content-Type: application/json

{
  "tableId": "<table-uuid>",
  "items": [
    { "menuItemId": "<menu-item-uuid>", "quantity": 2, "notes": "No onions" }
  ]
}
```

The waiter client must generate and persist one UUID per logical order before sending. If the network times out, it must retry that same payload with the same key. It must generate a new key only for a genuinely new order. Do not generate a fresh key on each retry.

## Database update

- Fresh database: use the current `database/schema.sql`.
- Existing database already on the phase-5 schema: apply `database/migrations/003_order_idempotency.sql` once.
- Take and verify a backup before applying migrations to any important database. This project has not been deployed to a live database.

## Verification boundaries

The request-hash unit tests and existing local tests run without PostgreSQL. The transaction/unique-key concurrency behavior is implemented using PostgreSQL constraints and `INSERT ... ON CONFLICT`, but still requires integration tests against PostgreSQL before relying on it in production. No Android offline queue or background sync worker is implemented yet; this phase supplies the server-side duplicate-prevention primitive those clients will need.
