const { AppError } = require('../errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  }
  // Postgres: invalid integer input, unique violation, immutable-row trigger
  if (err && err.code === '22P02') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid identifier or value' } });
  }
  if (err && err.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate value', details: err.detail } });
  }
  if (err && err.code === 'P0001') {
    return res.status(409).json({ error: { code: 'IMMUTABLE', message: err.message } });
  }
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } });
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, asyncRoute };
