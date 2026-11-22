-- Manual recovery and audit history for exhausted print jobs.
-- Apply once after migration 004; take a verified database backup first.
BEGIN;

ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_id_restaurant_unique UNIQUE (id, restaurant_id);

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

CREATE INDEX print_job_events_job_idx
  ON print_job_events(restaurant_id, print_job_id, created_at, id);

COMMIT;
