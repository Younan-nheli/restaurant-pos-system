import { createHash } from 'node:crypto';

/**
 * Hash only the fields that define an order request. Client-supplied names,
 * prices and routing fields are deliberately excluded because the API ignores
 * them and derives those values from the authenticated tenant's catalog.
 */
export function createOrderRequestHash({ tableId = null, items }) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');

  const canonicalRequest = {
    tableId,
    items: items.map(item => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      notes: item.notes ?? null
    }))
  };

  return createHash('sha256').update(JSON.stringify(canonicalRequest), 'utf8').digest('hex');
}
