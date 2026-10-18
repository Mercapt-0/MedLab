const { resetDb, loginAll, closePool, workflow, pool } = require('../helpers/api');

let u;
beforeAll(async () => {
  await resetDb();
  u = await loginAll();
});
afterAll(closePool);

describe('R-12 / US-08 Notifications', () => {
  test('correct role receives each event type; read / read-all work', async () => {
    const ctx = await workflow(u, { until: 'UNDER_REVIEW' });
    const tech = await u.tech.as.get('/api/notifications');
    expect(tech.body.notifications.some((n) => n.type === 'ORDER_ASSIGNED' && n.entity_id === ctx.order.id)).toBe(true);
    const doc = await u.physician.as.get('/api/notifications?unread=true');
    expect(doc.body.notifications.some((n) => n.type === 'RESULT_AVAILABLE' && n.entity_id === ctx.order.id)).toBe(true);
    expect(doc.body.unread).toBeGreaterThan(0);

    const first = doc.body.notifications[0];
    await u.physician.as.post(`/api/notifications/${first.id}/read`);
    const after = await u.physician.as.get('/api/notifications');
    expect(after.body.notifications.find((n) => n.id === first.id).read_at).toBeTruthy();

    await u.physician.as.post('/api/notifications/read-all');
    expect((await u.physician.as.get('/api/notifications')).body.unread).toBe(0);
  });

  test("a user cannot mark someone else's notification read", async () => {
    const t = await u.tech.as.get('/api/notifications');
    const id = t.body.notifications.find((n) => !n.read_at).id;
    await u.patient.as.post(`/api/notifications/${id}/read`);
    const { rows } = await pool.query('SELECT read_at FROM notifications WHERE id = $1', [id]);
    expect(rows[0].read_at).toBeNull();
  });
});

describe('R-15 / R-16 / US-11 Patient portal', () => {
  test('patient sees only released results; unreleased values are hidden', async () => {
    const released = await workflow(u, { codes: ['GLU'], value: 91 });
    const pending = await workflow(u, { codes: ['K'], until: 'UNDER_REVIEW', value: 4.2 });

    const o = await u.patient.as.get(`/api/orders/${pending.order.id}`);
    expect(o.status).toBe(200);
    expect(o.body.items[0].latest_data).toBeNull();

    const h = await u.patient.as.get(`/api/patients/${u.patient.user.id}/history`);
    const codes = h.body.tests.map((t) => t.testCode);
    expect(codes).toContain('GLU');
    expect(codes).not.toContain('K');
    const glu = h.body.tests.find((t) => t.itemId === released.item.id);
    expect(glu.versions[0].summary).toBe('91 mg/dL (ref 70-99)');
  });

  test('history includes superseded versions after an amendment, in order', async () => {
    const ctx = await workflow(u, { codes: ['NA'], value: 140 });
    await u.tech.as.post(`/api/order-items/${ctx.item.id}/amend`).send({ data: { value: 141 }, reason: 'Recalibrated' });
    const h = await u.patient.as.get(`/api/patients/${u.patient.user.id}/history`);
    const na = h.body.tests.find((t) => t.itemId === ctx.item.id);
    expect(na.versions.map((v) => [v.version, v.state])).toEqual([[1, 'SUPERSEDED'], [2, 'CURRENT']]);
  });

  test('downloadable PDF report for a released test; blocked for others and for unreleased', async () => {
    const ctx = await workflow(u, { codes: ['HGB'], value: 13.1 });
    const r = await u.patient.as.get(`/api/order-items/${ctx.item.id}/report`).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body.slice(0, 5).toString()).toBe('%PDF-');

    expect((await u.patient2.as.get(`/api/order-items/${ctx.item.id}/report`)).status).toBe(403);
    const pending = await workflow(u, { codes: ['WBC'], until: 'UNDER_REVIEW' });
    expect((await u.patient.as.get(`/api/order-items/${pending.item.id}/report`)).status).toBe(409);
  });
});

describe('R-19 Audit trail', () => {
  test('every state change is recorded with actor and timestamp', async () => {
    const ctx = await workflow(u, { codes: ['GLU'] });
    const r = await u.admin.as.get(`/api/orders/${ctx.order.id}/audit`);
    expect(r.status).toBe(200);
    const actions = r.body.map((a) => a.action);
    for (const a of ['CREATED', 'ASSIGNED', 'COLLECTED', 'PROCESSING_STARTED', 'RESULT_ENTERED', 'RESULT_AVAILABLE', 'SUBMITTED_FOR_REVIEW', 'RELEASED', 'AUTO_CLOSED']) {
      expect(actions).toContain(a);
    }
    for (const a of r.body) {
      expect(a.created_at).toBeTruthy();
    }
    expect(r.body.filter((a) => a.action !== 'AUTO_CLOSED').every((a) => a.actor_id)).toBe(true);
    expect(r.body.find((a) => a.action === 'RELEASED').actor_name).toBe('Dr. Paul Physician');
  });

  test('audit log is append-only at the database level', async () => {
    const { rows } = await pool.query('SELECT id FROM audit_log LIMIT 1');
    await expect(pool.query("UPDATE audit_log SET action = 'X' WHERE id = $1", [rows[0].id])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_log WHERE id = $1', [rows[0].id])).rejects.toThrow(/append-only/);
  });

  test('a failed transition leaves no partial state or audit entry (NFR-04 atomicity)', async () => {
    const ctx = await workflow(u, { until: 'ASSIGNED' });
    const before = (await pool.query('SELECT COUNT(*)::int c FROM audit_log')).rows[0].c;
    await u.tech.as.post(`/api/order-items/${ctx.item.id}/results`).send({ data: { value: 1 } }); // invalid: not collected
    const after = (await pool.query('SELECT COUNT(*)::int c FROM audit_log')).rows[0].c;
    expect(after).toBe(before);
    expect((await pool.query('SELECT COUNT(*)::int c FROM result_versions WHERE order_item_id = $1', [ctx.item.id])).rows[0].c).toBe(0);
  });
});
