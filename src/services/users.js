const bcrypt = require('bcryptjs');
const { query } = require('../db/pool');
const { badRequest, unauthorized, forbidden, notFound } = require('../errors');
const { signToken } = require('../middleware/auth');

const ROLES = ['physician', 'lab_admin', 'technician', 'patient'];
const PUBLIC_COLS = 'id, name, email, role, date_of_birth, is_on_call, is_lab_director, created_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createUser({ name, email, password, role, dateOfBirth, isOnCall = false, isLabDirector = false }) {
  if (!name || !String(name).trim()) throw badRequest('name is required');
  if (!email || !EMAIL_RE.test(email)) throw badRequest('A valid email is required');
  if (!password || String(password).length < 8) throw badRequest('Password must be at least 8 characters');
  if (!ROLES.includes(role)) throw badRequest(`role must be one of ${ROLES.join(', ')}`);

  const hash = await bcrypt.hash(String(password), 10);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role, date_of_birth, is_on_call, is_lab_director)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7) RETURNING ${PUBLIC_COLS}`,
    [String(name).trim(), email, hash, role, dateOfBirth || null, !!isOnCall && role === 'physician', !!isLabDirector]
  );
  return rows[0];
}

/** Public self-registration creates patient accounts only. Staff accounts are created by a lab admin. */
async function register(body) {
  const user = await createUser({ ...body, role: 'patient', isOnCall: false, isLabDirector: false });
  return { token: signToken(user), user };
}

async function login({ email, password }) {
  const { rows } = await query('SELECT * FROM users WHERE email = lower($1)', [email || '']);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    throw unauthorized('Invalid email or password');
  }
  delete user.password_hash;
  return { token: signToken(user), user };
}

async function listUsers(caller, { role, q }) {
  // Physicians may look up patients (to place orders); admins may list anyone.
  if (caller.role === 'physician' && role !== 'patient') throw forbidden('Physicians can only list patients');
  if (!['lab_admin', 'physician'].includes(caller.role)) throw forbidden();
  const where = [];
  const vals = [];
  if (role) { vals.push(role); where.push(`role = $${vals.length}`); }
  if (q) { vals.push(`%${q}%`); where.push(`(name ILIKE $${vals.length} OR email ILIKE $${vals.length})`); }
  const { rows } = await query(
    `SELECT ${PUBLIC_COLS} FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY role, name LIMIT 500`,
    vals
  );
  return rows;
}

async function updateFlags(id, { isOnCall, isLabDirector, name }) {
  const u = (await query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
  if (!u) throw notFound('User');
  if (isOnCall && u.role !== 'physician') throw badRequest('Only physicians can be on call');
  const { rows } = await query(
    `UPDATE users SET is_on_call = COALESCE($2, is_on_call), is_lab_director = COALESCE($3, is_lab_director),
            name = COALESCE($4, name)
      WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
    [id, isOnCall ?? null, isLabDirector ?? null, name ?? null]
  );
  return rows[0];
}

module.exports = { createUser, register, login, listUsers, updateFlags, ROLES };
