import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db/pool.js';
import { authRouter } from './routes/auth.js';
import { masterRouter } from './routes/master.js';
import { restaurantRouter } from './routes/restaurant.js';
import { ordersRouter } from './routes/orders.js';
import { printJobsRouter } from './routes/printJobs.js';
import { waiterRouter } from './routes/waiter.js';
import { authenticationRequired, requireRoles, tenantContext } from './middleware/tenantContext.js';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32)) {
  throw new Error('Production requires a JWT_SECRET of at least 32 bytes');
}
const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(v => v.trim()) : false }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); return res.json({ ok: true, service: 'restaurant-pos-api', database: 'connected' }); }
  catch { return res.status(503).json({ ok: false, service: 'restaurant-pos-api', database: 'unavailable' }); }
});
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/master', authenticationRequired, requireRoles('master_admin'), masterRouter);
app.use('/api/v1/restaurant', authenticationRequired, requireRoles('restaurant_admin'), restaurantRouter);
app.use('/api/v1/orders', authenticationRequired, ordersRouter);
app.use('/api/v1/waiter', authenticationRequired, waiterRouter);
app.use('/api/v1/print-jobs', authenticationRequired, printJobsRouter);
app.get('/api/v1/restaurant/context', authenticationRequired, tenantContext, (req, res) => {
  res.json({ restaurantId: req.tenant.restaurantId, platformAdmin: req.tenant.isPlatformAdmin });
});
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  return res.status(500).json({ error: 'internal_server_error' });
});
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => console.log(`POS API listening on ${port}`));
async function shutdown() { server.close(); await pool.end(); process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
