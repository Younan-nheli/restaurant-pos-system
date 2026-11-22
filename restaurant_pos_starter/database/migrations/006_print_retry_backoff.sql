-- Delay automatic retries after known printer failures to avoid exhausting
-- all attempts while a printer or restaurant LAN is briefly unavailable.
BEGIN;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS print_jobs_retry_claim_idx
  ON print_jobs(restaurant_id, routing_group, status, available_at, created_at, id);

COMMIT;
