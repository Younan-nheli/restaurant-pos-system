import { withSerializedTransaction } from './sqliteTransactions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTING_GROUPS = new Set(['kitchen', 'bar', 'other']);
const TABLE_STATUSES = new Set(['available', 'occupied', 'reserved', 'disabled']);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const WAITER_CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS waiter_catalog_meta (
  restaurant_id TEXT PRIMARY KEY NOT NULL,
  currency TEXT NOT NULL CHECK (length(currency)=3),
  timezone TEXT NOT NULL,
  server_time TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version=1)
);
CREATE TABLE IF NOT EXISTS waiter_catalog_categories (
  restaurant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (restaurant_id,id)
);
CREATE TABLE IF NOT EXISTS waiter_catalog_items (
  restaurant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  category_id TEXT,
  name TEXT NOT NULL,
  price_decimal TEXT NOT NULL,
  routing_group TEXT NOT NULL CHECK (routing_group IN ('kitchen','bar','other')),
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  PRIMARY KEY (restaurant_id,id)
);
CREATE TABLE IF NOT EXISTS waiter_catalog_service_areas (
  restaurant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (restaurant_id,id)
);
CREATE TABLE IF NOT EXISTS waiter_catalog_tables (
  restaurant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  service_area_id TEXT NOT NULL,
  service_area_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available','occupied','reserved','disabled')),
  PRIMARY KEY (restaurant_id,id)
);
CREATE INDEX IF NOT EXISTS waiter_catalog_items_category_idx
  ON waiter_catalog_items (restaurant_id,category_id,name);
CREATE INDEX IF NOT EXISTS waiter_catalog_tables_area_idx
  ON waiter_catalog_tables (restaurant_id,service_area_id,table_name);
`;

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError(`${field} must be a UUID`);
  return value.toLowerCase();
}

function requireText(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > maxLength) {
    throw new TypeError(`${field} must be non-empty text of at most ${maxLength} characters`);
  }
  return value.trim();
}

function requireArray(value, field, maxLength) {
  if (!Array.isArray(value) || value.length > maxLength) throw new TypeError(`${field} must be an array of at most ${maxLength} entries`);
  return value;
}

function requireUniqueIds(rows, field) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new TypeError(`${field} contains a duplicate ID`);
    ids.add(row.id);
  }
  return ids;
}

function normalizeSnapshot(restaurantId, snapshot, fetchedAt) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('catalog snapshot is required');
  const responseRestaurantId = requireUuid(snapshot.restaurantId, 'snapshot.restaurantId');
  if (responseRestaurantId !== restaurantId) throw new Error('Catalog response belongs to a different restaurant');
  if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) throw new TypeError('fetchedAt must be a non-negative integer timestamp');
  const restaurant = snapshot.restaurant;
  if (!restaurant || typeof restaurant !== 'object' || Array.isArray(restaurant)) throw new TypeError('snapshot.restaurant is required');
  if (typeof restaurant.currency !== 'string' || !/^[A-Z]{3}$/.test(restaurant.currency)) throw new TypeError('restaurant.currency must be a three-letter uppercase code');
  const timezone = requireText(restaurant.timezone, 'restaurant.timezone', 64);
  const serverTime = requireText(snapshot.serverTime, 'snapshot.serverTime', 40);
  if (!Number.isFinite(Date.parse(serverTime))) throw new TypeError('snapshot.serverTime must be a valid timestamp');

  const categories = requireArray(snapshot.categories, 'categories', 500).map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`categories[${index}] is invalid`);
    if (!Number.isSafeInteger(row.sortOrder) || Math.abs(row.sortOrder) > 1_000_000) throw new TypeError(`categories[${index}].sortOrder is invalid`);
    return { id: requireUuid(row.id, `categories[${index}].id`), name: requireText(row.name, `categories[${index}].name`, 120), sortOrder: row.sortOrder };
  });
  const categoryIds = requireUniqueIds(categories, 'categories');

  const items = requireArray(snapshot.items, 'items', 5_000).map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`items[${index}] is invalid`);
    const categoryId = row.categoryId == null ? null : requireUuid(row.categoryId, `items[${index}].categoryId`);
    if (categoryId && !categoryIds.has(categoryId)) throw new TypeError(`items[${index}] references a category outside this snapshot`);
    if (typeof row.price !== 'string' || !/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(row.price)) {
      throw new TypeError(`items[${index}].price must be a decimal string with at most two places`);
    }
    if (!ROUTING_GROUPS.has(row.routingGroup)) throw new TypeError(`items[${index}].routingGroup is invalid`);
    if (typeof row.active !== 'boolean') throw new TypeError(`items[${index}].active must be boolean`);
    return {
      id: requireUuid(row.id, `items[${index}].id`), categoryId,
      name: requireText(row.name, `items[${index}].name`, 160),
      price: row.price, routingGroup: row.routingGroup, active: row.active
    };
  });
  requireUniqueIds(items, 'items');

  const serviceAreas = requireArray(snapshot.serviceAreas, 'serviceAreas', 100).map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`serviceAreas[${index}] is invalid`);
    return { id: requireUuid(row.id, `serviceAreas[${index}].id`), name: requireText(row.name, `serviceAreas[${index}].name`, 120) };
  });
  const areaIds = requireUniqueIds(serviceAreas, 'serviceAreas');

  const tables = requireArray(snapshot.tables, 'tables', 2_000).map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`tables[${index}] is invalid`);
    const serviceAreaId = requireUuid(row.serviceAreaId, `tables[${index}].serviceAreaId`);
    if (!areaIds.has(serviceAreaId)) throw new TypeError(`tables[${index}] references a service area outside this snapshot`);
    if (!TABLE_STATUSES.has(row.status)) throw new TypeError(`tables[${index}].status is invalid`);
    return {
      id: requireUuid(row.id, `tables[${index}].id`), serviceAreaId,
      serviceAreaName: requireText(row.serviceAreaName, `tables[${index}].serviceAreaName`, 120),
      tableName: requireText(row.tableName, `tables[${index}].tableName`, 40), status: row.status
    };
  });
  requireUniqueIds(tables, 'tables');

  return {
    restaurantId, currency: restaurant.currency, timezone, serverTime,
    categories, items, serviceAreas, tables, fetchedAt
  };
}

function validateDb(db) {
  for (const method of ['execAsync', 'runAsync', 'getFirstAsync', 'getAllAsync', 'withTransactionAsync']) {
    if (typeof db?.[method] !== 'function') throw new TypeError(`SQLite database must implement ${method}()`);
  }
}

export function createWaiterCatalogCache(db) {
  validateDb(db);

  async function initialize() {
    await db.execAsync(WAITER_CATALOG_SCHEMA);
  }

  async function replaceSnapshot({ restaurantId, snapshot, fetchedAt = Date.now() }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    const normalized = normalizeSnapshot(restaurantId, snapshot, fetchedAt);
    await withSerializedTransaction(db, async () => {
      await db.runAsync(
        `INSERT INTO waiter_catalog_meta (restaurant_id,currency,timezone,server_time,fetched_at,schema_version)
         VALUES (?,?,?,?,?,1)
         ON CONFLICT (restaurant_id) DO UPDATE SET currency=excluded.currency,timezone=excluded.timezone,
           server_time=excluded.server_time,fetched_at=excluded.fetched_at,schema_version=1`,
        normalized.restaurantId, normalized.currency, normalized.timezone, normalized.serverTime, normalized.fetchedAt);

      for (const table of ['waiter_catalog_tables','waiter_catalog_items','waiter_catalog_categories','waiter_catalog_service_areas']) {
        await db.runAsync(`DELETE FROM ${table} WHERE restaurant_id=?`, restaurantId);
      }
      for (const row of normalized.categories) {
        await db.runAsync('INSERT INTO waiter_catalog_categories (restaurant_id,id,name,sort_order) VALUES (?,?,?,?)', restaurantId, row.id, row.name, row.sortOrder);
      }
      for (const row of normalized.items) {
        await db.runAsync('INSERT INTO waiter_catalog_items (restaurant_id,id,category_id,name,price_decimal,routing_group,active) VALUES (?,?,?,?,?,?,?)', restaurantId, row.id, row.categoryId, row.name, row.price, row.routingGroup, row.active ? 1 : 0);
      }
      for (const row of normalized.serviceAreas) {
        await db.runAsync('INSERT INTO waiter_catalog_service_areas (restaurant_id,id,name) VALUES (?,?,?)', restaurantId, row.id, row.name);
      }
      for (const row of normalized.tables) {
        await db.runAsync('INSERT INTO waiter_catalog_tables (restaurant_id,id,service_area_id,service_area_name,table_name,status) VALUES (?,?,?,?,?,?)', restaurantId, row.id, row.serviceAreaId, row.serviceAreaName, row.tableName, row.status);
      }
    });
    return getSnapshot({ restaurantId, now: fetchedAt });
  }

  async function getSnapshot({ restaurantId, now = Date.now(), maxAgeMs = 5 * 60 * 1000 }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > MAX_AGE_MS) {
      throw new TypeError('Invalid catalog cache clock or maxAgeMs');
    }
    const meta = await db.getFirstAsync('SELECT * FROM waiter_catalog_meta WHERE restaurant_id=?', restaurantId);
    if (!meta) return null;
    const [categories, items, serviceAreas, tables] = await Promise.all([
      db.getAllAsync('SELECT id,name,sort_order FROM waiter_catalog_categories WHERE restaurant_id=? ORDER BY sort_order,name,id', restaurantId),
      db.getAllAsync('SELECT id,category_id,name,price_decimal,routing_group,active FROM waiter_catalog_items WHERE restaurant_id=? ORDER BY name,id', restaurantId),
      db.getAllAsync('SELECT id,name FROM waiter_catalog_service_areas WHERE restaurant_id=? ORDER BY name,id', restaurantId),
      db.getAllAsync('SELECT id,service_area_id,service_area_name,table_name,status FROM waiter_catalog_tables WHERE restaurant_id=? ORDER BY service_area_name,table_name,id', restaurantId)
    ]);
    const fetchedAt = Number(meta.fetched_at);
    return {
      restaurantId, restaurant: { currency: meta.currency, timezone: meta.timezone },
      serverTime: meta.server_time,
      fetchedAt,
      stale: now < fetchedAt || now - fetchedAt > maxAgeMs,
      categories: categories.map(row => ({ id: row.id, name: row.name, sortOrder: Number(row.sort_order) })),
      items: items.map(row => ({ id: row.id, categoryId: row.category_id, name: row.name, price: row.price_decimal, routingGroup: row.routing_group, active: row.active === 1 })),
      serviceAreas: serviceAreas.map(row => ({ id: row.id, name: row.name })),
      tables: tables.map(row => ({ id: row.id, serviceAreaId: row.service_area_id, serviceAreaName: row.service_area_name, tableName: row.table_name, status: row.status }))
    };
  }

  async function clearRestaurant({ restaurantId }) {
    restaurantId = requireUuid(restaurantId, 'restaurantId');
    await withSerializedTransaction(db, async () => {
      for (const table of ['waiter_catalog_tables','waiter_catalog_items','waiter_catalog_categories','waiter_catalog_service_areas','waiter_catalog_meta']) {
        await db.runAsync(`DELETE FROM ${table} WHERE restaurant_id=?`, restaurantId);
      }
    });
  }

  return Object.freeze({ initialize, replaceSnapshot, getSnapshot, clearRestaurant });
}
