import { Router } from 'express';
import { pool } from '../db/pool.js';
import { canTransitionItemStatus, deriveOrderStatus, buildOrderDraftFromCatalog } from '../domain/orders.js';
import { requireRoles, tenantContext } from '../middleware/tenantContext.js';
import { decodeTicketCursor, encodeTicketCursor } from '../domain/ticketCursor.js';
import { createOrderRequestHash } from '../domain/orderIdempotency.js';
import { buildPreparationPrintJobs } from '../domain/printJobs.js';

export const ordersRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GROUPS = new Set(['kitchen', 'bar', 'other']);
const STATUSES = new Set(['pending', 'preparing', 'ready', 'served', 'void']);

ordersRouter.use(requireRoles('restaurant_admin', 'waiter', 'cashier', 'kitchen', 'bar'));
ordersRouter.use(tenantContext);
ordersRouter.use(async (req, res, next) => {
  try {
    const result = await pool.query('SELECT active FROM restaurants WHERE id=$1', [req.tenant.restaurantId]);
    if (!result.rowCount || !result.rows[0].active) return res.status(403).json({ error: 'restaurant_disabled_or_not_found' });
    return next();
  } catch (error) { return next(error); }
});

function validRequestedItems(items) {
  return Array.isArray(items) && items.length > 0 && items.length <= 100 && items.every(item =>
    item && typeof item === 'object' && typeof item.menuItemId === 'string' && UUID.test(item.menuItemId) &&
    Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 999 &&
    (item.notes === undefined || (typeof item.notes === 'string' && item.notes.length <= 500))
  );
}

ordersRouter.post('/', requireRoles('restaurant_admin', 'waiter'), async (req, res, next) => {
  const tableId = req.body?.tableId ?? null;
  if ((tableId !== null && (typeof tableId !== 'string' || !UUID.test(tableId))) || !validRequestedItems(req.body?.items)) {
    return res.status(400).json({ error: 'invalid_order_payload' });
  }
  const idempotencyKey = req.get('Idempotency-Key');
  if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) {
    return res.status(400).json({ error: 'valid_idempotency_key_required' });
  }
  const requestHash = createOrderRequestHash({ tableId, items: req.body.items });

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;

    const restaurant = await client.query(
      'SELECT currency FROM restaurants WHERE id=$1 AND active=true FOR SHARE', [req.tenant.restaurantId]);
    if (!restaurant.rowCount) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(403).json({ error: 'restaurant_disabled_or_not_found' });
    }

    const user = await client.query(
      `SELECT id FROM app_users WHERE id=$1 AND restaurant_id=$2 AND active=true
       AND role IN ('restaurant_admin','waiter') FOR SHARE`, [req.auth.userId, req.tenant.restaurantId]);
    if (!user.rowCount) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(401).json({ error: 'account_unavailable' });
    }

    // Reserve the tenant-scoped key in the same transaction as the order. A
    // concurrent retry waits on the unique key and then replays the committed
    // response instead of creating a second order.
    const reservation = await client.query(
      `INSERT INTO order_idempotency_requests (restaurant_id,idempotency_key,request_hash)
       VALUES ($1,$2,$3)
       ON CONFLICT (restaurant_id,idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [req.tenant.restaurantId, idempotencyKey, requestHash]);
    if (!reservation.rowCount) {
      const existing = await client.query(
        `SELECT request_hash,response_body FROM order_idempotency_requests
         WHERE restaurant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
        [req.tenant.restaurantId, idempotencyKey]);
      if (!existing.rowCount) throw new Error('idempotency reservation disappeared');
      if (existing.rows[0].request_hash !== requestHash) {
        await client.query('ROLLBACK'); transactionOpen = false;
        return res.status(409).json({ error: 'idempotency_key_reused_with_different_request' });
      }
      if (!existing.rows[0].response_body) {
        await client.query('ROLLBACK'); transactionOpen = false;
        return res.status(409).json({ error: 'idempotency_request_incomplete' });
      }
      await client.query('ROLLBACK'); transactionOpen = false;
      res.set('Idempotency-Replayed', 'true');
      return res.status(200).json(existing.rows[0].response_body);
    }

    let tableName = null;
    if (tableId) {
      const table = await client.query(
        'SELECT id,status,table_name FROM dining_tables WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',
        [tableId, req.tenant.restaurantId]);
      if (!table.rowCount) {
        await client.query('ROLLBACK'); transactionOpen = false;
        return res.status(404).json({ error: 'table_not_found' });
      }
      if (table.rows[0].status === 'disabled') {
        await client.query('ROLLBACK'); transactionOpen = false;
        return res.status(409).json({ error: 'table_disabled' });
      }
      tableName = table.rows[0].table_name;
    }

    const requestedIds = [...new Set(req.body.items.map(item => item.menuItemId))];
    const catalogResult = await client.query(
      `SELECT id,name,price::text AS price,routing_group,active
       FROM menu_items WHERE restaurant_id=$1 AND id=ANY($2::uuid[]) AND active=true FOR SHARE`,
      [req.tenant.restaurantId, requestedIds]);
    let draft;
    try {
      draft = buildOrderDraftFromCatalog({
        restaurantId: req.tenant.restaurantId,
        tableId,
        waiterId: req.auth.userId,
        requestedItems: req.body.items,
        catalogItems: catalogResult.rows,
        currency: restaurant.rows[0].currency
      });
    } catch (error) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(400).json({ error: 'menu_item_unavailable_or_invalid', detail: error.message });
    }

    const orderResult = await client.query(
      `INSERT INTO orders (restaurant_id,table_id,waiter_id,currency,status)
       VALUES ($1,$2,$3,$4,'sent') RETURNING id,restaurant_id,table_id,waiter_id,currency,status,created_at`,
      [req.tenant.restaurantId, tableId, req.auth.userId, restaurant.rows[0].currency]);
    const order = { ...orderResult.rows[0], table_name: tableName };
    const savedItems = [];
    for (const item of draft.items) {
      const saved = await client.query(
        `INSERT INTO order_items
          (restaurant_id,order_id,menu_item_id,item_name,quantity,unit_price,routing_group,notes,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
         RETURNING id,menu_item_id,item_name,quantity,unit_price,routing_group,notes,status`,
        [req.tenant.restaurantId, order.id, item.menuItemId, item.name, item.quantity,
          item.unitPriceDecimal, item.routingGroup, item.notes]);
      savedItems.push(saved.rows[0]);
    }

    if (tableId) {
      await client.query(
        `UPDATE dining_tables SET status='occupied' WHERE id=$1 AND restaurant_id=$2`,
        [tableId, req.tenant.restaurantId]);
    }

    const printJobs = buildPreparationPrintJobs({ order, items: savedItems });
    for (const job of printJobs) {
      await client.query(
        `INSERT INTO print_jobs (restaurant_id,order_id,routing_group,payload)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [job.restaurantId, job.orderId, job.routingGroup, JSON.stringify(job.payload)]);
    }

    const responseBody = {
      order,
      items: savedItems,
      subtotalMinor: draft.subtotalMinor,
      currency: draft.currency,
      tickets: draft.tickets,
      printJobsQueued: printJobs.length
    };
    const storedResponse = await client.query(
      `UPDATE order_idempotency_requests
       SET order_id=$3,response_body=$4::jsonb
       WHERE restaurant_id=$1 AND idempotency_key=$2 AND response_body IS NULL`,
      [req.tenant.restaurantId, idempotencyKey, order.id, JSON.stringify(responseBody)]);
    if (storedResponse.rowCount !== 1) throw new Error('idempotency response could not be stored');

    await client.query('COMMIT'); transactionOpen = false;
    res.set('Idempotency-Replayed', 'false');
    return res.status(201).json(responseBody);
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

ordersRouter.get('/', requireRoles('restaurant_admin', 'waiter', 'cashier'), async (req, res, next) => {
  const status = req.query.status;
  if (status !== undefined && !['open','sent','preparing','ready','served','paid','void'].includes(status)) {
    return res.status(400).json({ error: 'invalid_order_status' });
  }
  try {
    const result = await pool.query(
      `SELECT o.id,o.table_id,t.table_name,o.waiter_id,o.currency,o.status,o.created_at,
              COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE oi.status <> 'void'),0)::text AS total
       FROM orders o
       LEFT JOIN dining_tables t ON t.id=o.table_id AND t.restaurant_id=o.restaurant_id
       LEFT JOIN order_items oi ON oi.order_id=o.id AND oi.restaurant_id=o.restaurant_id
       WHERE o.restaurant_id=$1 AND ($2::text IS NULL OR o.status=$2)
       GROUP BY o.id,t.table_name ORDER BY o.created_at DESC LIMIT 100`,
      [req.tenant.restaurantId, status || null]);
    return res.json({ orders: result.rows });
  } catch (error) { return next(error); }
});

ordersRouter.get('/tickets', requireRoles('restaurant_admin', 'kitchen', 'bar'), async (req, res, next) => {
  const group = req.query.group;
  const status = req.query.status;
  const rawLimit = req.query.limit;
  if (!GROUPS.has(group) || (status !== undefined && !STATUSES.has(status))) {
    return res.status(400).json({ error: 'valid_ticket_group_and_status_required' });
  }
  if ((req.auth.role === 'kitchen' && group !== 'kitchen') || (req.auth.role === 'bar' && group !== 'bar')) {
    return res.status(403).json({ error: 'station_group_forbidden' });
  }

  const limit = rawLimit === undefined ? 100 : (/^[1-9]\d{0,2}$/.test(String(rawLimit)) ? Number(rawLimit) : NaN);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return res.status(400).json({ error: 'invalid_ticket_limit', maximum: 200 });
  }

  let cursor = null;
  if (req.query.cursor !== undefined) {
    try { cursor = decodeTicketCursor(req.query.cursor); }
    catch { return res.status(400).json({ error: 'invalid_ticket_cursor' }); }
  }

  try {
    const result = await pool.query(
      `SELECT oi.id AS order_item_id,oi.order_id,oi.item_name,oi.quantity,oi.unit_price::text AS unit_price,
              oi.routing_group,oi.notes,oi.status,o.currency,o.created_at,o.table_id,t.table_name,o.waiter_id,
              to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
       FROM order_items oi
       JOIN orders o ON o.id=oi.order_id AND o.restaurant_id=oi.restaurant_id
       LEFT JOIN dining_tables t ON t.id=o.table_id AND t.restaurant_id=o.restaurant_id
       WHERE oi.restaurant_id=$1 AND oi.routing_group=$2
         AND (($3::text IS NULL AND oi.status IN ('pending','preparing','ready')) OR oi.status=$3)
         AND ($4::timestamptz IS NULL OR (o.created_at,oi.id) > ($4::timestamptz,$5::uuid))
       ORDER BY o.created_at,oi.id LIMIT $6`,
      [req.tenant.restaurantId, group, status || null, cursor?.createdAt ?? null, cursor?.itemId ?? null, limit + 1]);

    const hasMore = result.rows.length > limit;
    const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const last = pageRows.at(-1);
    const nextCursor = hasMore && last
      ? encodeTicketCursor({ createdAt: last.cursor_created_at, itemId: last.order_item_id })
      : null;
    const tickets = pageRows.map(({ cursor_created_at: _cursorCreatedAt, ...ticket }) => ticket);
    return res.json({ group, tickets, page: { limit, hasMore, nextCursor } });
  } catch (error) { return next(error); }
});

ordersRouter.patch('/items/:id/status', requireRoles('restaurant_admin', 'kitchen', 'bar'), async (req, res, next) => {
  const nextStatus = req.body?.status;
  if (!UUID.test(req.params.id) || !STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: 'valid_item_id_and_status_required' });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN'); transactionOpen = true;
    const itemResult = await client.query(
      `SELECT id,order_id,routing_group,status FROM order_items
       WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`, [req.params.id, req.tenant.restaurantId]);
    if (!itemResult.rowCount) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(404).json({ error: 'order_item_not_found' });
    }
    const item = itemResult.rows[0];
    if ((req.auth.role === 'kitchen' && item.routing_group !== 'kitchen') ||
        (req.auth.role === 'bar' && item.routing_group !== 'bar')) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(403).json({ error: 'station_group_forbidden' });
    }
    const allowVoid = req.auth.role === 'restaurant_admin';
    if (!canTransitionItemStatus(item.status, nextStatus, { allowVoid })) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(409).json({ error: 'invalid_item_status_transition', currentStatus: item.status, requestedStatus: nextStatus });
    }

    const orderResult = await client.query(
      'SELECT status FROM orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',
      [item.order_id, req.tenant.restaurantId]);
    if (!orderResult.rowCount || ['paid','void'].includes(orderResult.rows[0].status)) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(409).json({ error: 'order_not_open_for_preparation' });
    }

    const updated = await client.query(
      `UPDATE order_items SET status=$1 WHERE id=$2 AND restaurant_id=$3
       RETURNING id,order_id,routing_group,status`, [nextStatus, item.id, req.tenant.restaurantId]);
    const statuses = await client.query(
      'SELECT status FROM order_items WHERE order_id=$1 AND restaurant_id=$2',
      [item.order_id, req.tenant.restaurantId]);
    const orderStatus = deriveOrderStatus(statuses.rows.map(row => row.status));
    await client.query(
      'UPDATE orders SET status=$1 WHERE id=$2 AND restaurant_id=$3',
      [orderStatus, item.order_id, req.tenant.restaurantId]);
    await client.query('COMMIT'); transactionOpen = false;
    return res.json({ item: updated.rows[0], orderStatus });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});
