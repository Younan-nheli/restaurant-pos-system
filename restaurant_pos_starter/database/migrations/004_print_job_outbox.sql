-- Durable, tenant-scoped preparation print outbox. Apply once after migration 003.
BEGIN;

CREATE TABLE IF NOT EXISTS print_jobs (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at TIMESTAMPTZ,
  UNIQUE (restaurant_id, order_id, routing_group),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders(id, restaurant_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'printing' AND claim_token IS NOT NULL AND claimed_until IS NOT NULL) OR
    (status <> 'printing' AND claim_token IS NULL AND claimed_until IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS print_jobs_claim_idx
  ON print_jobs(restaurant_id, routing_group, status, created_at, id);

COMMIT;
