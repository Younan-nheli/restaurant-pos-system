-- Fresh-install PostgreSQL schema for the POS API foundation.
-- Apply with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  timezone TEXT NOT NULL DEFAULT 'Asia/Baghdad',
  currency CHAR(3) NOT NULL DEFAULT 'IQD',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE RESTRICT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('master_admin','restaurant_admin','waiter','cashier','kitchen','bar')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, restaurant_id),
  CONSTRAINT user_tenant_role_check CHECK (
    (role = 'master_admin' AND restaurant_id IS NULL) OR
    (role <> 'master_admin' AND restaurant_id IS NOT NULL)
  )
);
CREATE INDEX app_users_restaurant_idx ON app_users(restaurant_id);
CREATE TABLE service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  UNIQUE (restaurant_id, name),
  UNIQUE (id, restaurant_id)
);
CREATE TABLE dining_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  service_area_id UUID NOT NULL,
  table_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','reserved','disabled')),
  UNIQUE (restaurant_id, table_name),
  FOREIGN KEY (service_area_id, restaurant_id) REFERENCES service_areas(id, restaurant_id) ON DELETE CASCADE
);
CREATE TABLE menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (id, restaurant_id)
);
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id UUID,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  routing_group TEXT NOT NULL DEFAULT 'kitchen' CHECK (routing_group IN ('kitchen','bar','other')),
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_categories(id, restaurant_id) ON DELETE RESTRICT
);
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  table_id UUID,
  waiter_id UUID,
  currency CHAR(3) NOT NULL DEFAULT 'IQD' CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sent','preparing','ready','served','paid','void')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (table_id, restaurant_id) REFERENCES dining_tables(id, restaurant_id) ON DELETE RESTRICT,
  FOREIGN KEY (waiter_id, restaurant_id) REFERENCES app_users(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX orders_restaurant_created_idx ON orders(restaurant_id, created_at DESC);
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL,
  menu_item_id UUID NOT NULL,
  item_name TEXT NOT NULL CHECK (length(trim(item_name)) > 0),
  quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  routing_group TEXT NOT NULL DEFAULT 'kitchen' CHECK (routing_group IN ('kitchen','bar','other')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','served','void')),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders(id, restaurant_id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id, restaurant_id) REFERENCES menu_items(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX order_items_station_status_idx ON order_items(restaurant_id, routing_group, status, order_id);
CREATE INDEX order_items_order_idx ON order_items(restaurant_id, order_id);
CREATE TABLE order_idempotency_requests (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  order_id UUID,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, idempotency_key),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders(id, restaurant_id) ON DELETE RESTRICT,
  CHECK ((order_id IS NULL AND response_body IS NULL) OR (order_id IS NOT NULL AND response_body IS NOT NULL))
);
CREATE INDEX order_idempotency_created_idx ON order_idempotency_requests(created_at);

CREATE TABLE print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  order_id UUID NOT NULL,
  routing_group TEXT NOT NULL CHECK (routing_group IN ('kitchen','bar','other')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','printing','printed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token UUID,
  claimed_until TIMESTAMPTZ,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at TIMESTAMPTZ,
  UNIQUE (restaurant_id, order_id, routing_group),
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders(id, restaurant_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'printing' AND claim_token IS NOT NULL AND claimed_until IS NOT NULL) OR
    (status <> 'printing' AND claim_token IS NULL AND claimed_until IS NULL)
  )
);
CREATE INDEX print_jobs_claim_idx ON print_jobs(restaurant_id, routing_group, status, created_at, id);
CREATE INDEX print_jobs_retry_claim_idx ON print_jobs(restaurant_id, routing_group, status, available_at, created_at, id);


CREATE TABLE print_job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  print_job_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('manual_requeue')),
  previous_status TEXT NOT NULL CHECK (previous_status IN ('failed')),
  previous_attempt_count INTEGER NOT NULL CHECK (previous_attempt_count >= 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (print_job_id, restaurant_id) REFERENCES print_jobs(id, restaurant_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id, restaurant_id) REFERENCES app_users(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX print_job_events_job_idx ON print_job_events(restaurant_id, print_job_id, created_at, id);
