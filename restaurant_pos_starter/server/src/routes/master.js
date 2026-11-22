import { Router } from 'express';
import { pool } from '../db/pool.js';
import { hashPassword, validatePassword } from '../security/passwords.js';

export const masterRouter = Router();

masterRouter.get('/restaurants', async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT r.id, r.name, r.timezone, r.currency, r.active, r.created_at,
      o.id AS organization_id, o.name AS organization_name
      FROM restaurants r JOIN organizations o ON o.id = r.organization_id ORDER BY r.created_at DESC`);
    return res.json({ restaurants: result.rows });
  } catch (error) { return next(error); }
});

masterRouter.post('/restaurants', async (req, res, next) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const organizationName = typeof req.body?.organizationName === 'string' ? req.body.organizationName.trim() : name;
  const adminEmail = typeof req.body?.adminEmail === 'string' ? req.body.adminEmail.trim().toLowerCase() : '';
  const adminPassword = req.body?.adminPassword;
  const currency = typeof req.body?.currency === 'string' ? req.body.currency.trim().toUpperCase() : 'IQD';
  const timezone = typeof req.body?.timezone === 'string' ? req.body.timezone.trim() : 'Asia/Baghdad';
  let validTimezone = false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); validTimezone = true; } catch {}
  if (!name || !organizationName || !/^\S+@\S+\.\S+$/.test(adminEmail) || !/^[A-Z]{3}$/.test(currency) || !validTimezone) {
    return res.status(400).json({ error: 'invalid_restaurant_or_admin_details' });
  }
  try { validatePassword(adminPassword); } catch (error) { return res.status(400).json({ error: error.message }); }
  const passwordHash = await hashPassword(adminPassword);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id, name', [organizationName]);
    const restaurant = await client.query(
      'INSERT INTO restaurants (organization_id, name, timezone, currency) VALUES ($1,$2,$3,$4) RETURNING id,name,timezone,currency,created_at',
      [org.rows[0].id, name, timezone, currency]
    );
    const admin = await client.query(
      `INSERT INTO app_users (restaurant_id,email,password_hash,role) VALUES ($1,$2,$3,'restaurant_admin') RETURNING id,email,role,restaurant_id`,
      [restaurant.rows[0].id, adminEmail, passwordHash]
    );
    await client.query('COMMIT');
    return res.status(201).json({ organization: org.rows[0], restaurant: restaurant.rows[0], admin: admin.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'admin_email_already_exists' });
    return next(error);
  } finally { client.release(); }
});


masterRouter.get('/restaurants/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.id,r.name,r.timezone,r.currency,r.active,r.created_at,
              o.id AS organization_id,o.name AS organization_name,
              COUNT(u.id) FILTER (WHERE u.active)::int AS active_users
       FROM restaurants r JOIN organizations o ON o.id=r.organization_id
       LEFT JOIN app_users u ON u.restaurant_id=r.id
       WHERE r.id=$1 GROUP BY r.id,o.id`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'restaurant_not_found' });
    return res.json({ restaurant: result.rows[0] });
  } catch (error) { return next(error); }
});

masterRouter.patch('/restaurants/:id/active', async (req, res, next) => {
  if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'active_boolean_required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      'UPDATE restaurants SET active=$1 WHERE id=$2 RETURNING id,name,active',
      [req.body.active, req.params.id]);
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'restaurant_not_found' });
    }
    // Disabling a tenant also blocks all its staff accounts from logging in.
    await client.query('UPDATE app_users SET active=$1 WHERE restaurant_id=$2', [req.body.active, req.params.id]);
    await client.query('COMMIT');
    return res.json({ restaurant: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally { client.release(); }
});
