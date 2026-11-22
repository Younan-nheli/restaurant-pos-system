-- Additive migration for order snapshots and kitchen/bar ticket routing.
-- Run once against an existing development database with psql -v ON_ERROR_STOP=1.
BEGIN;

-- PostgreSQL requires a unique key for the composite tenant-safe FK used by order_items.
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_id_restaurant_uq
  ON menu_items (id, restaurant_id);

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('master_admin','restaurant_admin','waiter','cashier','kitchen','bar'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency CHAR(3);
UPDATE orders o SET currency = r.currency FROM restaurants r
  WHERE r.id = o.restaurant_id AND o.currency IS NULL;
ALTER TABLE orders ALTER COLUMN currency SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_currency_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_currency_check
      CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
  END IF;
END $$;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS routing_group TEXT NOT NULL DEFAULT 'kitchen';

UPDATE order_items oi
SET item_name = mi.name,
    routing_group = mi.routing_group
FROM menu_items mi
WHERE mi.id = oi.menu_item_id
  AND mi.restaurant_id = oi.restaurant_id
  AND (oi.item_name IS NULL OR oi.routing_group = 'kitchen');

UPDATE order_items SET item_name = 'Unknown item' WHERE item_name IS NULL;
ALTER TABLE order_items ALTER COLUMN item_name SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_routing_group_check'
  ) THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_routing_group_check
      CHECK (routing_group IN ('kitchen','bar','other')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_status_check'
  ) THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_status_check
      CHECK (status IN ('pending','preparing','ready','served','void')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_items_station_status_idx
  ON order_items (restaurant_id, routing_group, status, order_id);
CREATE INDEX IF NOT EXISTS order_items_order_idx
  ON order_items (restaurant_id, order_id);

COMMIT;
