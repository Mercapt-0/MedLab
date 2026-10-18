const { request, app, resetDb, loginAll, closePool, as } = require('../helpers/api');

let u;
beforeAll(async () => {
  await resetDb();
  u = await loginAll();
});
afterAll(closePool);

describe('R-01 / US-01 Accounts and role-based login', () => {
  test('patient can self-register and log in', async () => {
    const reg = await request(app).post('/api/auth/register')
      .send({ name: 'New Patient', email: 'New.Patient@Example.com', password: 'longenough1' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe('patient');
    expect(reg.body.user.email).toBe('new.patient@example.com');
    expect(reg.body.user.password_hash).toBeUndefined();

    const login = await request(app).post('/api/auth/login').send({ email: 'new.patient@example.com', password: 'longenough1' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  test('self-registration cannot escalate to a staff role', async () => {
    const reg = await request(app).post('/api/auth/register')
      .send({ name: 'Sneaky', email: 'sneaky@example.com', password: 'longenough1', role: 'lab_admin' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe('patient');
  });

  test('registration validation', async () => {
    expect((await request(app).post('/api/auth/register').send({ name: 'x', email: 'bad', password: 'longenough1' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ name: 'x', email: 'a@b.co', password: 'short' })).status).toBe(400);
    const dup = await request(app).post('/api/auth/register').send({ name: 'x', email: 'patient@medlab.test', password: 'longenough1' });
    expect(dup.status).toBe(409);
  });

  test('wrong password is rejected with 401 and no token', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'admin@medlab.test', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.token).toBeUndefined();
  });

  test('lab admin creates staff accounts; /auth/me returns role', async () => {
    const r = await u.admin.as.post('/api/users').send({ name: 'Dr New', email: 'drnew@medlab.test', password: 'Password123!', role: 'physician' });
    expect(r.status).toBe(201);
    const me = await u.physician.as.get('/api/auth/me');
    expect(me.body.user.role).toBe('physician');
  });

  test('passwords are stored hashed (bcrypt), never plaintext (NFR-03)', async () => {
    const { pool } = require('../helpers/api');
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE email = 'admin@medlab.test'");
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$10\$/);
  });
});

describe('RBAC is enforced on the API, not just hidden in the UI (R-01, NFR-03)', () => {
  test('no token -> 401; garbage token -> 401', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
    expect((await as('garbage').get('/api/orders')).status).toBe(401);
  });

  test.each([
    ['patient', 'post', '/api/orders'],
    ['technician', 'post', '/api/orders'],
    ['patient', 'post', '/api/catalogue/tests'],
    ['physician', 'post', '/api/catalogue/tests'],
    ['technician', 'post', '/api/users'],
    ['physician', 'get', '/api/reports/turnaround'],
    ['patient', 'get', '/api/reports/turnaround'],
    ['physician', 'post', '/api/orders/1/assign'],
    ['patient', 'post', '/api/order-items/1/review'],
    ['physician', 'post', '/api/order-items/1/results'],
    ['patient', 'get', '/api/audit'],
  ])('%s cannot %s %s (403)', async (role, method, url) => {
    const key = { patient: 'patient', technician: 'tech', physician: 'physician' }[role];
    const r = await u[key].as[method](url).send({});
    expect(r.status).toBe(403);
  });

  test('physician cannot list staff accounts, only patients', async () => {
    expect((await u.physician.as.get('/api/users?role=technician')).status).toBe(403);
    const r = await u.physician.as.get('/api/users?role=patient');
    expect(r.status).toBe(200);
    expect(r.body.every((x) => x.role === 'patient')).toBe(true);
  });

  test("patient cannot read another patient's history", async () => {
    const r = await u.patient.as.get(`/api/patients/${u.patient2.user.id}/history`);
    expect(r.status).toBe(403);
    expect((await u.patient.as.get(`/api/patients/${u.patient.user.id}/history`)).status).toBe(200);
  });
});
