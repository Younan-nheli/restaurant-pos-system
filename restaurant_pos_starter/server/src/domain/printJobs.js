const PRINT_GROUPS = new Set(['kitchen', 'bar', 'other']);

/**
 * Build immutable printer payloads from rows already persisted by the server.
 * The payload is a snapshot: later menu edits must not rewrite an old ticket.
 */
export function buildPreparationPrintJobs({ order, items }) {
  if (!order || typeof order.id !== 'string' || typeof order.restaurant_id !== 'string') {
    throw new TypeError('A persisted order with tenant identity is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('Persisted order items are required');
  }

  const groups = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || typeof item.menu_item_id !== 'string' ||
        typeof item.item_name !== 'string' || !PRINT_GROUPS.has(item.routing_group) ||
        !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0 ||
        typeof item.unit_price !== 'string') {
      throw new TypeError('Invalid persisted order item for print job');
    }
    if (!groups.has(item.routing_group)) groups.set(item.routing_group, []);
    groups.get(item.routing_group).push(Object.freeze({
      orderItemId: item.id,
      menuItemId: item.menu_item_id,
      name: item.item_name,
      quantity: Number(item.quantity),
      unitPrice: item.unit_price,
      notes: item.notes ?? null
    }));
  }

  return Object.freeze([...groups.entries()].map(([routingGroup, ticketItems]) => Object.freeze({
    restaurantId: order.restaurant_id,
    orderId: order.id,
    routingGroup,
    payload: Object.freeze({
      orderId: order.id,
      tableId: order.table_id ?? null,
      tableName: order.table_name ?? null,
      currency: order.currency,
      createdAt: order.created_at instanceof Date ? order.created_at.toISOString() : String(order.created_at),
      routingGroup,
      items: Object.freeze(ticketItems)
    })
  })));
}

export function canClaimPrintGroup(role, group) {
  if (!PRINT_GROUPS.has(group)) return false;
  if (role === 'restaurant_admin') return true;
  return (role === 'kitchen' && group === 'kitchen') || (role === 'bar' && group === 'bar');
}

/** Only a Restaurant Admin may manually reopen an exhausted print job. */
export function canManuallyRequeuePrintJob(role, status) {
  return role === 'restaurant_admin' && status === 'failed';
}
