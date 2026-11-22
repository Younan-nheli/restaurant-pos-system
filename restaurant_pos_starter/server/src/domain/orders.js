const ROUTING_GROUPS = new Set(['kitchen', 'bar', 'other']);
export const ITEM_STATUSES = Object.freeze(['pending', 'preparing', 'ready', 'served', 'void']);

const ITEM_TRANSITIONS = Object.freeze({
  pending: new Set(['preparing']),
  preparing: new Set(['ready']),
  ready: new Set(['served']),
  served: new Set(),
  void: new Set()
});

/**
 * Convert a PostgreSQL NUMERIC(12,2) value to integer hundredths without
 * passing through floating-point arithmetic. The returned integer is used
 * for exact totals; the configured currency remains attached to the order.
 */
export function decimalToMinorUnits(value) {
  const raw = normalizePrice(value);
  const [wholePart, fractionPart] = raw.split('.');
  const minor = Number(wholePart) * 100 + Number(fractionPart);
  if (!Number.isSafeInteger(minor)) throw new RangeError('price is too large');
  return minor;
}

function normalizePrice(value) {
  // pg returns NUMERIC as a string. Reject JS decimals to avoid binary rounding.
  const raw = typeof value === 'string' ? value : (Number.isSafeInteger(value) && value >= 0 ? String(value) : '');
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new TypeError('price must be a non-negative decimal with at most two decimal places');
  return `${match[1]}.${(match[2] || '').padEnd(2, '0')}`;
}

/** Build an order from trusted menu rows loaded by the API, never client prices. */
export function buildOrderDraftFromCatalog({ restaurantId, tableId = null, waiterId, requestedItems, catalogItems, currency = 'IQD' }) {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new TypeError('Order must contain at least one item');
  }
  if (!Array.isArray(catalogItems)) throw new TypeError('catalogItems must be an array');

  const catalog = new Map(catalogItems.map(item => [item.id, item]));
  const items = requestedItems.map((requested, index) => {
    if (!requested || typeof requested !== 'object' || typeof requested.menuItemId !== 'string') {
      throw new TypeError(`items[${index}].menuItemId is required`);
    }
    const product = catalog.get(requested.menuItemId);
    if (!product || product.active !== true) throw new TypeError(`items[${index}] references an unavailable menu item`);
    return {
      menuItemId: product.id,
      name: product.name,
      quantity: requested.quantity,
      unitPriceMinor: decimalToMinorUnits(product.price),
      unitPriceDecimal: normalizePrice(product.price),
      routingGroup: product.routing_group,
      notes: requested.notes
    };
  });

  return buildOrderDraft({ restaurantId, tableId, waiterId, items, currency });
}

/** Build a validated immutable order draft and deterministic preparation tickets. */
export function buildOrderDraft({ restaurantId, tableId = null, waiterId, items, currency = 'IQD' }) {
  if (!isNonEmptyString(restaurantId)) throw new TypeError('restaurantId is required');
  if (!isNonEmptyString(waiterId)) throw new TypeError('waiterId is required');
  if (tableId !== null && !isNonEmptyString(tableId)) throw new TypeError('tableId must be a string or null');
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError('currency must be a three-letter uppercase code');
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('Order must contain at least one item');

  const normalizedItems = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new TypeError(`items[${index}] must be an object`);
    if (!isNonEmptyString(item.menuItemId)) throw new TypeError(`items[${index}].menuItemId is required`);
    if (!isNonEmptyString(item.name)) throw new TypeError(`items[${index}].name is required`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 999) {
      throw new TypeError(`items[${index}].quantity must be an integer between 1 and 999`);
    }
    if (!Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) {
      throw new TypeError(`items[${index}].unitPriceMinor must be a non-negative safe integer`);
    }
    const unitPriceDecimal = item.unitPriceDecimal === undefined
      ? (item.unitPriceMinor / 100).toFixed(2) : normalizePrice(item.unitPriceDecimal);
    if (decimalToMinorUnits(unitPriceDecimal) !== item.unitPriceMinor) throw new TypeError(`items[${index}].unitPriceDecimal does not match unitPriceMinor`);
    const routingGroup = item.routingGroup ?? 'kitchen';
    if (!ROUTING_GROUPS.has(routingGroup)) throw new TypeError(`items[${index}].routingGroup is invalid`);
    const lineTotalMinor = item.quantity * item.unitPriceMinor;
    if (!Number.isSafeInteger(lineTotalMinor)) throw new RangeError(`items[${index}] total is too large`);
    return Object.freeze({
      menuItemId: item.menuItemId,
      name: item.name.trim(),
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      unitPriceDecimal,
      lineTotalMinor,
      routingGroup,
      notes: typeof item.notes === 'string' ? item.notes.trim().slice(0, 500) : ''
    });
  });

  const subtotalMinor = normalizedItems.reduce((sum, item) => {
    const next = sum + item.lineTotalMinor;
    if (!Number.isSafeInteger(next)) throw new RangeError('Order subtotal is too large');
    return next;
  }, 0);

  const ticketsByGroup = new Map();
  for (const item of normalizedItems) {
    if (!ticketsByGroup.has(item.routingGroup)) ticketsByGroup.set(item.routingGroup, []);
    ticketsByGroup.get(item.routingGroup).push(item);
  }

  const tickets = [...ticketsByGroup.entries()].map(([routingGroup, ticketItems]) => Object.freeze({
    routingGroup,
    items: Object.freeze(ticketItems),
    subtotalMinor: ticketItems.reduce((sum, item) => sum + item.lineTotalMinor, 0)
  }));

  return Object.freeze({
    restaurantId,
    tableId,
    waiterId,
    items: Object.freeze(normalizedItems),
    subtotalMinor,
    currency,
    tickets: Object.freeze(tickets)
  });
}

export function canTransitionItemStatus(current, next, { allowVoid = false } = {}) {
  if (!ITEM_STATUSES.includes(current) || !ITEM_STATUSES.includes(next)) return false;
  if (current === next) return true;
  if (allowVoid && next === 'void' && ['pending', 'preparing', 'ready'].includes(current)) return true;
  return ITEM_TRANSITIONS[current].has(next);
}

export function deriveOrderStatus(itemStatuses) {
  if (!Array.isArray(itemStatuses) || itemStatuses.length === 0) throw new TypeError('itemStatuses must not be empty');
  if (itemStatuses.some(status => !ITEM_STATUSES.includes(status))) throw new TypeError('unknown item status');
  if (itemStatuses.every(status => status === 'void')) return 'void';
  const live = itemStatuses.filter(status => status !== 'void');
  if (live.every(status => status === 'served')) return 'served';
  if (live.every(status => status === 'ready' || status === 'served')) return 'ready';
  if (live.some(status => status === 'preparing' || status === 'ready')) return 'preparing';
  return 'sent';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
