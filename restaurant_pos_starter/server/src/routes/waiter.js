import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireRoles, tenantContext } from '../middleware/tenantContext.js';

export const waiterRouter = Router();
waiterRouter.use(requireRoles('restaurant_admin', 'waiter'));
waiterRouter.use(tenantContext);

waiterRouter.get('/catalog', async (req, res, next) => {
  try {
    const restaurantId = req.tenant.restaurantId;
    const restaurantResult = await pool.query(
      'SELECT id,currency,timezone FROM restaurants WHERE id=$1 AND active=true', [restaurantId]);
    if (!restaurantResult.rowCount) return res.status(403).json({ error: 'restaurant_disabled_or_not_found' });

    const [categories, items, serviceAreas, tables] = await Promise.all([
      pool.query(
        'SELECT id,name,sort_order FROM menu_categories WHERE restaurant_id=$1 ORDER BY sort_order,name,id',
        [restaurantId]),
      pool.query(
        `SELECT id,category_id,name,price::text AS price,routing_group,active
         FROM menu_items WHERE restaurant_id=$1 AND active=true ORDER BY name,id`, [restaurantId]),
      pool.query(
        'SELECT id,name FROM service_areas WHERE restaurant_id=$1 ORDER BY name,id', [restaurantId]),
      pool.query(
        `SELECT t.id,t.service_area_id,a.name AS service_area_name,t.table_name,t.status
         FROM dining_tables t JOIN service_areas a
           ON a.id=t.service_area_id AND a.restaurant_id=t.restaurant_id
         WHERE t.restaurant_id=$1 ORDER BY a.name,t.table_name,t.id`, [restaurantId])
    ]);

    res.set('Cache-Control', 'private, no-store');
    return res.json({
      restaurantId,
      serverTime: new Date().toISOString(),
      restaurant: {
        currency: restaurantResult.rows[0].currency.trim(),
        timezone: restaurantResult.rows[0].timezone
      },
      categories: categories.rows.map(row => ({ id: row.id, name: row.name, sortOrder: row.sort_order })),
      items: items.rows.map(row => ({
        id: row.id, categoryId: row.category_id, name: row.name, price: row.price,
        routingGroup: row.routing_group, active: row.active
      })),
      serviceAreas: serviceAreas.rows,
      tables: tables.rows.map(row => ({
        id: row.id, serviceAreaId: row.service_area_id, serviceAreaName: row.service_area_name,
        tableName: row.table_name, status: row.status
      }))
    });
  } catch (error) { return next(error); }
});
