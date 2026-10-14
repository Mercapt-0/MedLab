const router = require('express').Router();
const { asyncRoute } = require('../middleware/errorHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const users = require('../services/users');

// Public
router.post('/auth/register', asyncRoute(async (req, res) => res.status(201).json(await users.register(req.body))));
router.post('/auth/login', asyncRoute(async (req, res) => res.json(await users.login(req.body))));
router.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

// User administration
router.get('/users', authenticate, asyncRoute(async (req, res) => res.json(await users.listUsers(req.user, req.query))));
router.post('/users', authenticate, requireRole('lab_admin'), asyncRoute(async (req, res) => res.status(201).json(await users.createUser(req.body))));
router.patch('/users/:id', authenticate, requireRole('lab_admin'), asyncRoute(async (req, res) => res.json(await users.updateFlags(req.params.id, req.body))));

module.exports = router;
