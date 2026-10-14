const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'medlab-api' }));
  app.use('/api', require('./routes/auth'));
  app.use('/api', require('./routes/catalogue'));
  app.use('/api', require('./routes/orders'));
  app.use('/api', require('./routes/misc'));

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
