import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { canClaimPrintGroup, canManuallyRequeuePrintJob } from '../domain/printJobs.js';
import { PRINT_RETRY_DELAY_INTERVAL_SQL } from '../domain/printRetryPolicy.js';
import { requireRoles, tenantContext } from '../middleware/tenantContext.js';

export const printJobsRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GROUPS = new Set(['kitchen', 'bar', 'other']);

printJobsRouter.use(requireRoles('restaurant_admin', 'kitchen', 'bar'));
printJobsRouter.use(tenantContext);
printJobsRouter.use(async (req, res, next) => {
  try {
    const result = await pool.query('SELECT active FROM restaurants WHERE id=$1', [req.tenant.restaurantId]);
    if (!result.rowCount || !result.rows[0].active) return res.status(403).json({ error: 'restaurant_disabled_or_not_found' });
    return next();
  } catch (error) { return next(error); }
});

function validateGroup(req, res) {
  const group = req.body?.group;
  if (!GROUPS.has(group)) {
    res.status(400).json({ error: 'valid_print_group_required' });
    return null;
  }
  if (!canClaimPrintGroup(req.auth.role, group)) {
    res.status(403).json({ error: 'station_group_forbidden' });
    return null;
  }
  return group;
}

// Operational visibility is restricted to Restaurant Admins; station accounts
// can only claim and acknowledge their own group's jobs.
printJobsRouter.get('/', requireRoles('restaurant_admin'), async (req, res, next) => {
  const status = req.query.status;
  const group = req.query.group;
  const rawLimit = req.query.limit;
  if ((status !== undefined && !['pending', 'printing', 'printed', 'failed'].includes(status)) ||
      (group !== undefined && !GROUPS.has(group))) {
    return res.status(400).json({ error: 'invalid_print_job_filter' });
  }
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'invalid_print_job_limit' });
  }
  try {
    const result = await pool.query(
      `SELECT job.id,job.order_id,job.routing_group,job.payload,job.status,
              job.attempt_count,job.last_error,job.available_at,job.created_at,job.claimed_until,job.printed_at,
              (SELECT count(*)::int FROM print_job_events ev
               WHERE ev.print_job_id=job.id AND ev.restaurant_id=job.restaurant_id) AS manual_event_count
       FROM print_jobs job
       WHERE job.restaurant_id=$1 AND ($2::text IS NULL OR job.status=$2)
         AND ($3::text IS NULL OR job.routing_group=$3)
       ORDER BY job.created_at DESC,job.id DESC LIMIT $4`,
      [req.tenant.restaurantId, status ?? null, group ?? null, limit]);
    return res.json({ jobs: result.rows });
  } catch (error) { return next(error); }
});

printJobsRouter.post('/:id/requeue', requireRoles('restaurant_admin'), async (req, res, next) => {
  if (!UUID.test(req.params.id) || typeof req.body?.reason !== 'string' ||
      req.body.reason.trim().length === 0 || req.body.reason.length > 500) {
    return res.status(400).json({ error: 'valid_job_id_and_requeue_reason_required' });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN'); transactionOpen = true;
    const current = await client.query(
      `SELECT id,status,attempt_count FROM print_jobs
       WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
      [req.params.id, req.tenant.restaurantId]);
    if (!current.rowCount) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(404).json({ error: 'print_job_not_found' });
    }
    const job = current.rows[0];
    if (!canManuallyRequeuePrintJob(req.auth.role, job.status)) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(409).json({ error: 'only_failed_jobs_can_be_manually_requeued', status: job.status });
    }
    const updated = await client.query(
      `UPDATE print_jobs SET status='pending',attempt_count=0,claim_token=NULL,
         claimed_until=NULL,last_error=NULL,printed_at=NULL,available_at=now()
       WHERE id=$1 AND restaurant_id=$2 AND status='failed'
       RETURNING id,order_id,routing_group,status,attempt_count,created_at`,
      [req.params.id, req.tenant.restaurantId]);
    if (updated.rowCount !== 1) throw new Error('print job changed during manual requeue');
    await client.query(
      `INSERT INTO print_job_events
         (restaurant_id,print_job_id,actor_user_id,event_type,previous_status,previous_attempt_count,reason)
       VALUES ($1,$2,$3,'manual_requeue',$4,$5,$6)`,
      [req.tenant.restaurantId, req.params.id, req.auth.userId, job.status, job.attempt_count, req.body.reason.trim()]);
    await client.query('COMMIT'); transactionOpen = false;
    return res.status(200).json({ job: updated.rows[0], requeued: true });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

printJobsRouter.get('/:id/events', requireRoles('restaurant_admin'), async (req, res, next) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'valid_job_id_required' });
  try {
    const exists = await pool.query(
      'SELECT id FROM print_jobs WHERE id=$1 AND restaurant_id=$2',
      [req.params.id, req.tenant.restaurantId]);
    if (!exists.rowCount) return res.status(404).json({ error: 'print_job_not_found' });
    const result = await pool.query(
      `SELECT id,event_type,previous_status,previous_attempt_count,reason,created_at
       FROM print_job_events WHERE print_job_id=$1 AND restaurant_id=$2
       ORDER BY created_at,id`,
      [req.params.id, req.tenant.restaurantId]);
    return res.json({ events: result.rows });
  } catch (error) { return next(error); }
});

// Atomically leases one job. Expired leases are eligible again after a worker crash.
printJobsRouter.post('/claim', async (req, res, next) => {
  const group = validateGroup(req, res);
  if (!group) return;
  const claimToken = randomUUID();
  try {
    const result = await pool.query(
      `WITH exhausted_leases AS (
         UPDATE print_jobs
         SET status='failed',claim_token=NULL,claimed_until=NULL,
             last_error='Print worker lease expired after maximum attempts'
         WHERE restaurant_id=$1 AND routing_group=$2 AND status='printing'
           AND claimed_until < now() AND attempt_count >= 5
         RETURNING id
       ), candidate AS (
         SELECT id FROM print_jobs
         WHERE restaurant_id=$1 AND routing_group=$2 AND attempt_count < 5
           AND ((status='pending' AND available_at <= now()) OR
                (status='printing' AND claimed_until < now()))
         ORDER BY created_at,id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE print_jobs AS job
       SET status='printing', attempt_count=job.attempt_count+1,
           claim_token=$3, claimed_until=now()+interval '120 seconds', last_error=NULL
       FROM candidate
       WHERE job.id=candidate.id AND job.restaurant_id=$1
       RETURNING job.id,job.order_id,job.routing_group,job.payload,
                 job.attempt_count,job.claim_token,job.claimed_until`,
      [req.tenant.restaurantId, group, claimToken]);
    if (!result.rowCount) return res.status(204).end();
    return res.json({ job: result.rows[0] });
  } catch (error) { return next(error); }
});

printJobsRouter.post('/:id/complete', async (req, res, next) => {
  if (!UUID.test(req.params.id) || !UUID.test(req.body?.claimToken || '')) {
    return res.status(400).json({ error: 'valid_job_id_and_claim_token_required' });
  }
  try {
    const stationGroup = req.auth.role === 'kitchen' ? 'kitchen' : req.auth.role === 'bar' ? 'bar' : null;
    const result = await pool.query(
      `UPDATE print_jobs SET status='printed',printed_at=now(),claim_token=NULL,
         claimed_until=NULL,last_error=NULL
       WHERE id=$1 AND restaurant_id=$2 AND status='printing' AND claim_token=$3
         AND ($4::text IS NULL OR routing_group=$4)
       RETURNING id,status,printed_at,routing_group`,
      [req.params.id, req.tenant.restaurantId, req.body.claimToken, stationGroup]);
    if (!result.rowCount) return res.status(409).json({ error: 'print_job_claim_not_current' });
    return res.json({ job: result.rows[0] });
  } catch (error) { return next(error); }
});

printJobsRouter.post('/:id/fail', async (req, res, next) => {
  const { claimToken, error: reportedError } = req.body || {};
  if (!UUID.test(req.params.id) || !UUID.test(claimToken || '') ||
      typeof reportedError !== 'string' || reportedError.trim().length === 0 || reportedError.length > 500) {
    return res.status(400).json({ error: 'valid_job_failure_details_required' });
  }
  try {
    const stationGroup = req.auth.role === 'kitchen' ? 'kitchen' : req.auth.role === 'bar' ? 'bar' : null;
    const result = await pool.query(
      `UPDATE print_jobs SET
         status=CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
         available_at=now()+(${PRINT_RETRY_DELAY_INTERVAL_SQL}),
         claim_token=NULL,claimed_until=NULL,last_error=$4
       WHERE id=$1 AND restaurant_id=$2 AND status='printing' AND claim_token=$3
         AND ($5::text IS NULL OR routing_group=$5)
       RETURNING id,status,attempt_count,routing_group`,
      [req.params.id, req.tenant.restaurantId, claimToken, reportedError.trim(), stationGroup]);
    if (!result.rowCount) return res.status(409).json({ error: 'print_job_claim_not_current' });
    return res.json({ job: result.rows[0] });
  } catch (error) { return next(error); }
});
