/**
 * Shared test helpers: DB reset, login, and workflow shortcuts that drive the real API.
 */
const request = require('supertest');
const { createApp } = require('../../backend/src/app');
const { pool } = require('../../backend/src/db/pool');
const { seed, PASSWORD } = require('../../backend/src/db/seed');
const clock = require('../../backend/src/services/clock');

const app = createApp();

const EMAILS = {
  admin: 'admin@medlab.test',
  director: 'director@medlab.test',
  physician: 'physician@medlab.test',
  oncall: 'oncall@medlab.test',
  tech: 'tech@medlab.test',
  tech2: 'tech2@medlab.test',
  patient: 'patient@medlab.test',
  patient2: 'riya@medlab.test',
};

async function resetDb({ bulk = false } = {}) {
  clock.reset();
  await pool.query(`TRUNCATE audit_log, notifications, panic_alerts, result_versions, order_items, specimens,
                    order_panels, orders, panel_tests, panels, lab_tests, users RESTART IDENTITY CASCADE`);
  await pool.query('ALTER SEQUENCE accession_seq RESTART WITH 1');
  return seed({ bulk });
}

/** Log in every demo user; returns { admin: {token,user,as}, physician: {...}, ... } */
async function loginAll() {
  const out = {};
  for (const [key, email] of Object.entries(EMAILS)) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    out[key] = { token: res.body.token, user: res.body.user, as: as(res.body.token) };
  }
  return out;
}

/** Fluent authenticated client: as(token).get('/api/...') */
function as(token) {
  const wrap = (method) => (url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), delete: wrap('delete') };
}

async function testId(code) {
  return (await pool.query('SELECT id FROM lab_tests WHERE code = $1', [code])).rows[0].id;
}
async function panelId(code) {
  return (await pool.query('SELECT id FROM panels WHERE code = $1', [code])).rows[0].id;
}

/** Drive one order through the workflow up to `until` stage. Returns { order, item(s), specimen }. */
async function workflow(u, { codes = ['GLU'], panels = [], priority = 'routine', until = 'RELEASED', value } = {}) {
  const testIds = await Promise.all(codes.map(testId));
  const panelIds = await Promise.all(panels.map(panelId));
  const ctx = {};
  let r = await u.physician.as.post('/api/orders').send({ patientId: u.patient.user.id, priority, testIds, panelIds });
  expectStatus(r, 201);
  ctx.order = r.body;
  ctx.items = r.body.items;
  ctx.item = r.body.items[0];
  if (until === 'PENDING') return ctx;

  expectStatus(await u.admin.as.post(`/api/orders/${ctx.order.id}/assign`).send({ technicianId: u.tech.user.id }), 200);
  if (until === 'ASSIGNED') return ctx;

  r = await u.tech.as.post(`/api/orders/${ctx.order.id}/specimens`);
  expectStatus(r, 201);
  ctx.specimen = r.body;
  if (until === 'COLLECTED') return ctx;

  expectStatus(await u.tech.as.post(`/api/specimens/${ctx.specimen.id}/process`), 200);
  if (until === 'IN_PROCESSING') return ctx;

  for (const it of ctx.items) {
    const data = it.category === 'quantitative' ? { value: value ?? 85 }
      : it.category === 'qualitative' ? { interpretation: 'negative' } : { growth: false };
    expectStatus(await u.tech.as.post(`/api/order-items/${it.id}/results`).send({ data }), 201);
  }
  if (until === 'RESULT_AVAILABLE') return ctx;

  for (const it of ctx.items) expectStatus(await u.tech.as.post(`/api/order-items/${it.id}/submit`), 200);
  if (until === 'UNDER_REVIEW') return ctx;

  for (const it of ctx.items) {
    expectStatus(await u.physician.as.post(`/api/order-items/${it.id}/review`).send({ decision: 'approve' }), 200);
  }
  return ctx;
}

function expectStatus(res, status) {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}

async function closePool() {
  await pool.end();
}

module.exports = { app, request, pool, clock, resetDb, loginAll, as, testId, panelId, workflow, expectStatus, closePool, PASSWORD };
