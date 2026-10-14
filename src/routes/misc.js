const router = require('express').Router();
const { asyncRoute } = require('../middleware/errorHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const escalation = require('../services/escalation');
const patients = require('../services/patients');
const reports = require('../services/reports');
const { query } = require('../db/pool');
const clock = require('../services/clock');

router.use(authenticate);

// Panic alerts (R-13)
router.get('/panic-alerts', asyncRoute(async (req, res) => res.json(await escalation.listAlerts(req.user, req.query))));
router.post('/panic-alerts/:id/acknowledge', asyncRoute(async (req, res) => res.json(await escalation.acknowledge(req.user, req.params.id, req.body && req.body.note))));

// Notifications (R-12)
router.get('/notifications', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM notifications WHERE user_id = $1 ${req.query.unread === 'true' ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC, id DESC LIMIT 100`,
    [req.user.id]
  );
  const unread = (await query('SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].c;
  res.json({ unread, notifications: rows });
}));
router.post('/notifications/:id/read', asyncRoute(async (req, res) => {
  await query('UPDATE notifications SET read_at = $3 WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [req.params.id, req.user.id, clock.now()]);
  res.json({ ok: true });
}));
router.post('/notifications/read-all', asyncRoute(async (req, res) => {
  await query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [req.user.id, clock.now()]);
  res.json({ ok: true });
}));

// Patient history + report download (R-15, R-16)
router.get('/patients/:id/history', asyncRoute(async (req, res) => res.json(await patients.history(req.user, req.params.id))));
router.get('/order-items/:id/report', asyncRoute(async (req, res) => patients.streamReport(req.user, req.params.id, res)));

// Turnaround-time report (R-18)
router.get('/reports/turnaround', requireRole('lab_admin'), asyncRoute(async (req, res) => res.json(await reports.turnaround(req.query))));

module.exports = router;
