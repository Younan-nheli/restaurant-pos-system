-- Prevent duplicate order creation when a waiter retries after a timeout or
-- reconnects after an uncertain network result. Apply once to an existing DB.
BEGIN;

CREATE TABLE IF NOT EXISTS order_idempotency_requests (
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

CREATE INDEX IF NOT EXISTS order_idempotency_created_idx
  ON order_idempotency_requests(created_at);

COMMIT;
