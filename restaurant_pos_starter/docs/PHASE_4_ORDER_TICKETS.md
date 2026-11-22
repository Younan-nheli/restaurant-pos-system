# Phase 4 – Order entry and preparation tickets

## Implemented in this phase

- `POST /api/v1/orders` creates an order and all its lines in one PostgreSQL transaction.
- The API accepts menu item IDs and quantities only. Names, prices and routing groups are read from the authenticated restaurant's active menu, so a waiter cannot submit a forged price or redirect a drink to the kitchen.
- Restaurant, user, table and menu lookups are scoped to the tenant ID from the signed access token. Cross-restaurant table/menu IDs are rejected.
- Every authenticated API request now re-checks the account's active flag, role and restaurant against the token; disabling an account or changing its role invalidates existing sessions immediately.
- The order and each order line store snapshots of the currency, menu name, unit price and routing group, so later restaurant/menu edits do not rewrite historical tickets. Prices are kept at the schema's two-decimal precision; the returned `subtotalMinor` is an exact integer count of hundredths of the configured currency unit.
- `GET /api/v1/orders` lists the authenticated restaurant's orders and calculated totals.
- `GET /api/v1/orders/tickets?group=kitchen|bar|other` supplies preparation queues. Kitchen users can only read kitchen tickets; bar users can only read bar tickets; Restaurant Admin can inspect all groups. The queue is tenant-scoped and defaults to active items (`pending`, `preparing`, `ready`).
- Ticket queues now use bounded keyset pagination (`limit`, maximum 200) with a versioned opaque `cursor`. The cursor retains PostgreSQL microsecond timestamp precision and the item UUID tie-breaker, avoiding offset scans and unstable page boundaries when many tickets share an order timestamp. The cursor is only a paging hint; tenant authorization is applied independently to every page.
- `PATCH /api/v1/orders/items/:id/status` applies forward-only item transitions (`pending → preparing → ready → served`). Restaurant Admin may also void an uncompleted line. The parent order status is recalculated in the same transaction.
- A dining table is marked occupied in the same transaction as order creation.
- Added the `bar` staff role and tenant-safe composite uniqueness on menu items. The latter also fixes a fresh-schema foreign-key target that was missing from the previous package.

## API examples

Create an order (the API deliberately ignores client-supplied name/price/routing fields):

```http
POST /api/v1/orders
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "tableId": "<table-uuid>",
  "items": [
    { "menuItemId": "<food-uuid>", "quantity": 2, "notes": "No onions" },
    { "menuItemId": "<drink-uuid>", "quantity": 1 }
  ]
}
```

Read kitchen or bar queue:

```http
GET /api/v1/orders/tickets?group=kitchen
GET /api/v1/orders/tickets?group=bar&status=ready&limit=50
```

A queue response includes `page.limit`, `page.hasMore` and `page.nextCursor`. To fetch the next page, send the returned cursor unchanged:

```http
GET /api/v1/orders/tickets?group=kitchen&limit=50&cursor=<nextCursor>
```

For a fresh screen refresh/poll, start again without a cursor so newly created tickets are included. A cursor is not a credential and never grants access to another restaurant.

Advance an item:

```http
PATCH /api/v1/orders/items/<order-item-uuid>/status
Content-Type: application/json

{ "status": "preparing" }
```

## Database update

- Fresh database: apply `database/schema.sql` only.
- Existing development database with the earlier tables successfully created: back up it, then apply `database/migrations/002_order_tickets.sql` once.
- The previous bundled schema omitted a required composite unique key for one foreign key. If its initial schema application stopped at `order_items`, use a clean development database with the current `schema.sql`; the additive migration does not reconstruct missing tables.
- Do not run either path on a live database without a reviewed backup/migration plan.

## Verification boundaries

The pure order-domain, security and ticket-cursor tests (17 total in this package) and JavaScript syntax checks can run without PostgreSQL. This phase has not yet been integration-tested against a real PostgreSQL instance, tested in the browser/Android app, or connected to physical KDS/Bar displays or ESC/POS printers. It is not production-ready. Payment, split/merged bills, offline sync, Android waiter UI and printer delivery remain future work.
