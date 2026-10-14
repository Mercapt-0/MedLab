const router = require('express').Router();
const { asyncRoute } = require('../middleware/errorHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const orders = require('../services/orders');
const specimens = require('../services/specimens');
const results = require('../services/results');
const { query } = require('../db/pool');
const { forbidden } = require('../errors');

router.use(authenticate);

// Orders
router.post('/orders', requireRole('physician'), asyncRoute(async (req, res) => res.status(201).json(await orders.createOrder(req.user, req.body))));
router.get('/orders', asyncRoute(async (req, res) => res.json(await orders.searchOrders(req.user, req.query))));
router.get('/orders/:id', asyncRoute(async (req, res) => res.json(await orders.getOrder(req.user, req.params.id))));
router.post('/orders/:id/assign', requireRole('lab_admin'), asyncRoute(async (req, res) => res.json(await orders.assignOrder(req.user, req.params.id, req.body.technicianId))));
router.post('/orders/:id/close', requireRole('lab_admin', 'physician'), asyncRoute(async (req, res) => res.json(await orders.closeOrder(req.user, req.params.id))));
router.post('/orders/:id/cancel', requireRole('lab_admin', 'physician'), asyncRoute(async (req, res) => res.json(await orders.cancelOrder(req.user, req.params.id, req.body.reason))));

// Specimens
router.post('/orders/:id/specimens', requireRole('technician'), asyncRoute(async (req, res) => res.status(201).json(await specimens.collectSpecimen(req.user, req.params.id))));
router.post('/specimens/:id/process', requireRole('technician'), asyncRoute(async (req, res) => res.json(await specimens.startProcessing(req.user, req.params.id))));
router.post('/specimens/:id/reject', requireRole('technician'), asyncRoute(async (req, res) => res.json(await specimens.rejectSpecimen(req.user, req.params.id, req.body.reason))));

// Results (per order item = component test)
router.post('/order-items/:id/results', requireRole('technician'), asyncRoute(async (req, res) => res.status(201).json(await results.enterResult(req.user, req.params.id, req.body.data))));
router.post('/order-items/:id/submit', requireRole('technician'), asyncRoute(async (req, res) => res.json(await results.submitForReview(req.user, req.params.id))));
router.post('/order-items/:id/review', requireRole('physician'), asyncRoute(async (req, res) => res.json(await results.review(req.user, req.params.id, req.body))));
router.post('/order-items/:id/amend', requireRole('technician', 'physician'), asyncRoute(async (req, res) => res.status(201).json(await results.amend(req.user, req.params.id, req.body))));
router.post('/order-items/:id/cancel', requireRole('physician', 'lab_admin'), asyncRoute(async (req, res) => {
  await orders.cancelItem(req.user, req.params.id, req.body.reason);
  res.json({ ok: true });
}));
router.get('/order-items/:id/history', asyncRoute(async (req, res) => res.json(await results.history(req.user, req.params.id))));

// Audit trail for an order (all entities touching it)
router.get('/orders/:id/audit', requireRole('lab_admin', 'physician', 'technician'), asyncRoute(async (req, res) => {
  await orders.getOrder(req.user, req.params.id); // reuse view permission check
  const { rows } = await query(
    `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE (a.entity_type = 'order' AND a.entity_id = $1)
         OR (a.entity_type = 'order_item' AND a.entity_id IN (SELECT id FROM order_items WHERE order_id = $1))
         OR (a.entity_type = 'specimen'   AND a.entity_id IN (SELECT id FROM specimens WHERE order_id = $1))
         OR (a.entity_type = 'result'     AND a.entity_id IN (SELECT v.id FROM result_versions v JOIN order_items i ON i.id = v.order_item_id WHERE i.order_id = $1))
         OR (a.entity_type = 'panic_alert' AND a.entity_id IN (SELECT pa.id FROM panic_alerts pa JOIN order_items i ON i.id = pa.order_item_id WHERE i.order_id = $1))
      ORDER BY a.created_at, a.id`,
    [req.params.id]
  );
  res.json(rows);
}));

router.get('/audit', asyncRoute(async (req, res) => {
  if (req.user.role !== 'lab_admin') throw forbidden();
  const { rows } = await query(
    `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ${req.query.entityType ? 'WHERE a.entity_type = $1' : ''} ORDER BY a.id DESC LIMIT 300`,
    req.query.entityType ? [req.query.entityType] : []
  );
  res.json(rows);
}));

module.exports = router;
