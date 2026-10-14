const router = require('express').Router();
const { asyncRoute } = require('../middleware/errorHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const catalogue = require('../services/catalogue');

router.use('/catalogue', authenticate);
router.get('/catalogue/tests', asyncRoute(async (req, res) =>
  res.json(await catalogue.listTests({ includeInactive: req.user.role === 'lab_admin' && req.query.all === 'true' }))));
router.post('/catalogue/tests', requireRole('lab_admin'), asyncRoute(async (req, res) => res.status(201).json(await catalogue.createTest(req.user, req.body))));
router.patch('/catalogue/tests/:id', requireRole('lab_admin'), asyncRoute(async (req, res) => res.json(await catalogue.updateTest(req.user, req.params.id, req.body))));
router.get('/catalogue/panels', asyncRoute(async (_req, res) => res.json(await catalogue.listPanels())));
router.post('/catalogue/panels', requireRole('lab_admin'), asyncRoute(async (req, res) => res.status(201).json(await catalogue.createPanel(req.user, req.body))));
router.patch('/catalogue/panels/:id', requireRole('lab_admin'), asyncRoute(async (req, res) => res.json(await catalogue.updatePanel(req.user, req.params.id, req.body))));

module.exports = router;
