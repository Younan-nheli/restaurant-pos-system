import { Router } from 'express';
import { pool } from '../db/pool.js';
import { tenantContext } from '../middleware/tenantContext.js';

export const restaurantRouter = Router();
restaurantRouter.use(tenantContext);
restaurantRouter.use(async (req, res, next) => {
  try {
    const result = await pool.query('SELECT active FROM restaurants WHERE id=$1', [req.tenant.restaurantId]);
    if (!result.rowCount || !result.rows[0].active) return res.status(403).json({ error: 'restaurant_disabled_or_not_found' });
    return next();
  } catch (error) { return next(error); }
});

function requiredText(value, max = 120) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    ? value.trim() : null;
}

// Summary is scoped exclusively to the restaurant ID from the signed access token.
restaurantRouter.get('/dashboard', async (req, res, next) => {
  try {
    const id = req.tenant.restaurantId;
    const [orders, tables, menu] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status NOT IN ('paid','void'))::int AS active
                  FROM orders WHERE restaurant_id = $1 AND created_at >= date_trunc('day', now())`, [id]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied
                  FROM dining_tables WHERE restaurant_id = $1`, [id]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active
                  FROM menu_items WHERE restaurant_id = $1`, [id])
    ]);
    return res.json({ orders: orders.rows[0], tables: tables.rows[0], menuItems: menu.rows[0] });
  } catch (error) { return next(error); }
});

restaurantRouter.get('/service-areas', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.name, COUNT(t.id)::int AS table_count
       FROM service_areas a LEFT JOIN dining_tables t
         ON t.service_area_id = a.id AND t.restaurant_id = a.restaurant_id
       WHERE a.restaurant_id = $1 GROUP BY a.id ORDER BY a.name`, [req.tenant.restaurantId]);
    return res.json({ serviceAreas: result.rows });
  } catch (error) { return next(error); }
});

restaurantRouter.post('/service-areas', async (req, res, next) => {
  const name = requiredText(req.body?.name);
  if (!name) return res.status(400).json({ error: 'valid_name_required' });
  try {
    const result = await pool.query(
      'INSERT INTO service_areas (restaurant_id, name) VALUES ($1,$2) RETURNING id,name',
      [req.tenant.restaurantId, name]);
    return res.status(201).json({ serviceArea: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'service_area_name_exists' });
    return next(error);
  }
});

restaurantRouter.get('/tables', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.table_name, t.status, t.service_area_id, a.name AS service_area_name
       FROM dining_tables t JOIN service_areas a
         ON a.id = t.service_area_id AND a.restaurant_id = t.restaurant_id
       WHERE t.restaurant_id = $1 ORDER BY a.name, t.table_name`, [req.tenant.restaurantId]);
    return res.json({ tables: result.rows });
  } catch (error) { return next(error); }
});

restaurantRouter.post('/tables', async (req, res, next) => {
  const tableName = requiredText(req.body?.tableName, 40);
  const serviceAreaId = typeof req.body?.serviceAreaId === 'string' ? req.body.serviceAreaId : '';
  if (!tableName || !/^[0-9a-f-]{36}$/i.test(serviceAreaId)) {
    return res.status(400).json({ error: 'valid_table_and_service_area_required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO dining_tables (restaurant_id, service_area_id, table_name)
       SELECT $1, a.id, $3 FROM service_areas a WHERE a.id = $2 AND a.restaurant_id = $1
       RETURNING id, table_name, status, service_area_id`,
      [req.tenant.restaurantId, serviceAreaId, tableName]);
    if (!result.rowCount) return res.status(404).json({ error: 'service_area_not_found' });
    return res.status(201).json({ table: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'table_name_exists' });
    return next(error);
  }
});

restaurantRouter.get('/menu/categories', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id,name,sort_order FROM menu_categories WHERE restaurant_id=$1 ORDER BY sort_order,name',
      [req.tenant.restaurantId]);
    return res.json({ categories: result.rows });
  } catch (error) { return next(error); }
});

restaurantRouter.post('/menu/categories', async (req, res, next) => {
  const name = requiredText(req.body?.name);
  const sortOrder = Number.isInteger(req.body?.sortOrder) ? req.body.sortOrder : 0;
  if (!name) return res.status(400).json({ error: 'valid_name_required' });
  try {
    const result = await pool.query(
      'INSERT INTO menu_categories (restaurant_id,name,sort_order) VALUES ($1,$2,$3) RETURNING id,name,sort_order',
      [req.tenant.restaurantId, name, sortOrder]);
    return res.status(201).json({ category: result.rows[0] });
  } catch (error) { return next(error); }
});

restaurantRouter.get('/menu/items', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.id,m.name,m.price,m.routing_group,m.active,m.category_id,c.name AS category_name
       FROM menu_items m LEFT JOIN menu_categories c
         ON c.id=m.category_id AND c.restaurant_id=m.restaurant_id
       WHERE m.restaurant_id=$1 ORDER BY c.sort_order,c.name,m.name`,
      [req.tenant.restaurantId]);
    return res.json({ items: result.rows });
  } catch (error) { return next(error); }
});

restaurantRouter.post('/menu/items', async (req, res, next) => {
  const name = requiredText(req.body?.name);
  const price = req.body?.price;
  const routing = req.body?.routingGroup || 'kitchen';
  const categoryId = req.body?.categoryId || null;
  if (!name || typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
      !['kitchen','bar','other'].includes(routing) ||
      (categoryId !== null && (typeof categoryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(categoryId)))) {
    return res.status(400).json({ error: 'invalid_menu_item' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO menu_items (restaurant_id,category_id,name,price,routing_group)
       SELECT $1,c.id,$3,$4,$5 FROM (SELECT 1) seed
       LEFT JOIN menu_categories c ON c.id=$2 AND c.restaurant_id=$1
       WHERE $2::uuid IS NULL OR c.id IS NOT NULL
       RETURNING id,name,price,routing_group,active,category_id`,
      [req.tenant.restaurantId, categoryId, name, price, routing]);
    if (!result.rowCount) return res.status(404).json({ error: 'category_not_found' });
    return res.status(201).json({ item: result.rows[0] });
  } catch (error) { return next(error); }
});

restaurantRouter.patch('/menu/items/:id/active', async (req, res, next) => {
  if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'active_boolean_required' });
  try {
    const result = await pool.query(
      'UPDATE menu_items SET active=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING id,name,active',
      [req.body.active, req.params.id, req.tenant.restaurantId]);
    if (!result.rowCount) return res.status(404).json({ error: 'menu_item_not_found' });
    return res.json({ item: result.rows[0] });
  } catch (error) { return next(error); }
});
