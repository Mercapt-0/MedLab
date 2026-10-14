const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/pool');
const { unauthorized, forbidden } = require('../errors');

/** Verify the bearer token and load the *current* user row (so role/flag changes apply immediately). */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const { rows } = await query(
      'SELECT id, name, email, role, date_of_birth, is_on_call, is_lab_director FROM users WHERE id = $1',
      [payload.sub]
    );
    if (!rows[0]) throw unauthorized('User no longer exists');
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Role guard enforced on the server for every endpoint (R-01, NFR-03):
 * access is denied, not merely hidden in the UI.
 */
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden(`Requires role: ${roles.join(' or ')}`));
  next();
};

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

module.exports = { authenticate, requireRole, signToken };
