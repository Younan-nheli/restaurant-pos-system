import { verifyAccessToken } from '../security/tokens.js';
import { isTokenIdentityCurrent } from '../security/auth.js';
import { pool } from '../db/pool.js';

export async function authenticationRequired(req, res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  if (!match) return res.status(401).json({ error: 'authentication_required' });
  const claims = verifyAccessToken(match[1], process.env.JWT_SECRET);
  if (!claims || typeof claims.sub !== 'string') return res.status(401).json({ error: 'invalid_or_expired_token' });
  try {
    // Re-check current account state so disabled users or changed roles lose
    // access immediately instead of retaining privileges until token expiry.
    const result = await pool.query(
      'SELECT id,restaurant_id,role,active FROM app_users WHERE id=$1 LIMIT 1', [claims.sub]);
    const user = result.rows[0];
    if (!isTokenIdentityCurrent(claims, user)) return res.status(401).json({ error: 'session_no_longer_valid' });
    req.auth = { userId: user.id, role: user.role, restaurantId: user.restaurant_id ?? null };
    return next();
  } catch (error) { return next(error); }
}

export function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.auth?.role)
    ? next()
    : res.status(403).json({ error: 'forbidden' });
}

export function tenantContext(req, res, next) {
  // Tenant IDs come only from signed claims. Client-supplied x-restaurant-id is ignored.
  if (req.auth?.role === 'master_admin') req.tenant = { restaurantId: null, isPlatformAdmin: true };
  else req.tenant = { restaurantId: req.auth?.restaurantId ?? null, isPlatformAdmin: false };
  if (req.auth && !req.tenant.isPlatformAdmin && !req.tenant.restaurantId) {
    return res.status(403).json({ error: 'restaurant_context_required' });
  }
  return next();
}
