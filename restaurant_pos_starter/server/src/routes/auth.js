import { Router } from 'express';
import { pool } from '../db/pool.js';
import { verifyPassword } from '../security/passwords.js';
import { signAccessToken } from '../security/tokens.js';
import { authenticationRequired } from '../middleware/tenantContext.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!email || typeof password !== 'string') return res.status(400).json({ error: 'email_and_password_required' });
    const result = await pool.query(
      `SELECT u.id, u.restaurant_id, u.email, u.password_hash, u.role, u.active,
              COALESCE(r.active, true) AS restaurant_active
       FROM app_users u LEFT JOIN restaurants r ON r.id=u.restaurant_id
       WHERE u.email = $1 LIMIT 1`, [email]
    );
    const user = result.rows[0];
    if (!user || !user.active || !user.restaurant_active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const token = signAccessToken({ sub: user.id, role: user.role, restaurantId: user.restaurant_id }, process.env.JWT_SECRET,
      Number(process.env.TOKEN_TTL_SECONDS || 28800));
    return res.json({ accessToken: token, tokenType: 'Bearer', expiresIn: Number(process.env.TOKEN_TTL_SECONDS || 28800), user: {
      id: user.id, email: user.email, role: user.role, restaurantId: user.restaurant_id
    }});
  } catch (error) { return next(error); }
});

authRouter.get('/me', authenticationRequired, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT id, restaurant_id, email, role, active FROM app_users WHERE id = $1 LIMIT 1', [req.auth.userId]);
    const user = result.rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'account_unavailable' });
    return res.json({ id: user.id, email: user.email, role: user.role, restaurantId: user.restaurant_id });
  } catch (error) { return next(error); }
});
