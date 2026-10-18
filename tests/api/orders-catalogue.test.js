const { resetDb, loginAll, closePool, testId, panelId, workflow } = require('../helpers/api');

let u;
beforeAll(async () => {
  await resetDb();
  u = await loginAll();
});
afterAll(closePool);

describe('R-02 / US-02 Physician places an order', () => {
  test('order with 2+ tests and STAT flag appears tagged in the admin queue', async () => {
    const r = await u.physician.as.post('/api/orders').send({
      patientId: u.patient.user.id, priority: 'stat', testIds: [await testId('GLU'), await testId('K')],
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING');
    expect(r.body.priority).toBe('stat');
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items.every((i) => i.status === 'COLLECTION_REQUIRED')).toBe(true);

    const queue = await u.admin.as.get('/api/orders?unassigned=true');
    const found = queue.body.orders.find((o) => o.id === r.body.id);
    expect(found.priority).toBe('stat');
    expect(queue.body.orders[0].priority).toBe('stat'); // STAT sorted first
  });

  test('validation: empty order, bad priority, non-patient target', async () => {
    const pid = u.patient.user.id;
    expect((await u.physician.as.post('/api/orders').send({ patientId: pid, testIds: [] })).status).toBe(400);
    expect((await u.physician.as.post('/api/orders').send({ patientId: pid, priority: 'urgent', testIds: [await testId('GLU')] })).status).toBe(400);
    expect((await u.physician.as.post('/api/orders').send({ patientId: u.tech.user.id, testIds: [await testId('GLU')] })).status).toBe(400);
    expect((await u.physician.as.post('/api/orders').send({ patientId: pid, testIds: [99999] })).status).toBe(400);
  });

  test('placing an order notifies lab administrators', async () => {
    const n = await u.admin.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'ORDER_PLACED')).toBe(true);
  });
});

describe('R-03 Panels expand into independently tracked components', () => {
  test('CBC panel creates 3 items; panel status = least-complete component', async () => {
    const ctx = await workflow(u, { codes: [], panels: ['CBC'], until: 'UNDER_REVIEW' });
    expect(ctx.items).toHaveLength(3);

    // release only one component
    await u.physician.as.post(`/api/order-items/${ctx.items[0].id}/review`).send({ decision: 'approve' });
    const o = await u.physician.as.get(`/api/orders/${ctx.order.id}`);
    expect(o.body.panels).toHaveLength(1);
    expect(o.body.panels[0].code).toBe('CBC');
    expect(o.body.panels[0].status).toBe('UNDER_REVIEW');
    const statuses = o.body.items.map((i) => i.status).sort();
    expect(statuses).toEqual(['RELEASED', 'UNDER_REVIEW', 'UNDER_REVIEW']);
  });
});

describe('R-04 Catalogue management', () => {
  test('admin adds a test with reference range and TAT, attaches it to a panel, and it is orderable', async () => {
    const t = await u.admin.as.post('/api/catalogue/tests').send({
      code: 'mg', name: 'Magnesium', category: 'quantitative', unit: 'mg/dL', refLow: 1.7, refHigh: 2.2, panicLow: 1, panicHigh: 4.9, tatHours: 6,
    });
    expect(t.status).toBe(201);
    expect(t.body.code).toBe('MG');
    expect(t.body.ref_low).toBe(1.7);

    const p = await u.admin.as.post('/api/catalogue/panels').send({ code: 'LYTES', name: 'Electrolytes', testIds: [await testId('NA'), await testId('K'), t.body.id] });
    expect(p.status).toBe(201);
    const panels = await u.physician.as.get('/api/catalogue/panels');
    expect(panels.body.find((x) => x.code === 'LYTES').tests.map((x) => x.code)).toContain('MG');

    const order = await u.physician.as.post('/api/orders').send({ patientId: u.patient.user.id, panelIds: [p.body.id] });
    expect(order.status).toBe(201);
    expect(order.body.items.map((i) => i.test_code).sort()).toEqual(['K', 'MG', 'NA']);
  });

  test('catalogue validation', async () => {
    expect((await u.admin.as.post('/api/catalogue/tests').send({ code: 'X', name: 'X', category: 'imaging' })).status).toBe(400);
    expect((await u.admin.as.post('/api/catalogue/tests').send({ code: 'Y', name: 'Y', category: 'quantitative', refLow: 10, refHigh: 1 })).status).toBe(400);
    expect((await u.admin.as.post('/api/catalogue/tests').send({ code: 'GLU', name: 'dup', category: 'quantitative' })).status).toBe(409);
    expect((await u.admin.as.post('/api/catalogue/panels').send({ code: 'ONE', name: 'one', testIds: [await testId('GLU')] })).status).toBe(400);
  });

  test('deactivated tests cannot be ordered', async () => {
    const id = await testId('UCX');
    await u.admin.as.patch(`/api/catalogue/tests/${id}`).send({ active: false });
    const r = await u.physician.as.post('/api/orders').send({ patientId: u.patient.user.id, testIds: [id] });
    expect(r.status).toBe(400);
    await u.admin.as.patch(`/api/catalogue/tests/${id}`).send({ active: true });
  });
});

describe('R-05 Assignment and reassignment', () => {
  test('reassigning moves the order from technician A to technician B queue', async () => {
    const ctx = await workflow(u, { until: 'ASSIGNED' });
    let a = await u.tech.as.get('/api/orders');
    expect(a.body.orders.map((o) => o.id)).toContain(ctx.order.id);

    const r = await u.admin.as.post(`/api/orders/${ctx.order.id}/assign`).send({ technicianId: u.tech2.user.id });
    expect(r.status).toBe(200);
    expect(r.body.assigned_technician_id).toBe(u.tech2.user.id);

    a = await u.tech.as.get('/api/orders');
    const b = await u.tech2.as.get('/api/orders');
    expect(a.body.orders.map((o) => o.id)).not.toContain(ctx.order.id);
    expect(b.body.orders.map((o) => o.id)).toContain(ctx.order.id);

    // old technician can no longer act on it
    expect((await u.tech.as.post(`/api/orders/${ctx.order.id}/specimens`)).status).toBe(403);
    const n = await u.tech2.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'ORDER_ASSIGNED' && x.entity_id === ctx.order.id)).toBe(true);
  });

  test('cannot assign to a non-technician', async () => {
    const ctx = await workflow(u, { until: 'PENDING' });
    const r = await u.admin.as.post(`/api/orders/${ctx.order.id}/assign`).send({ technicianId: u.physician.user.id });
    expect(r.status).toBe(400);
  });
});

describe('R-17 Search and filter', () => {
  test('filters by test code, status, priority and patient name, scoped per role', async () => {
    await workflow(u, { codes: ['TROP'], priority: 'stat', until: 'PENDING' });
    const r = await u.admin.as.get('/api/orders?test=TROP&priority=stat&status=PENDING&patient=Pat');
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(0);
    for (const o of r.body.orders) {
      expect(o.priority).toBe('stat');
      expect(o.status).toBe('PENDING');
      expect(o.items.some((i) => i.code === 'TROP')).toBe(true);
      expect(o.patient_name).toMatch(/Pat/);
    }
    // Patient 2 has no orders, so their own search is empty
    const p2 = await u.patient2.as.get('/api/orders');
    expect(p2.body.total).toBe(0);
  });

  test('date range filter excludes orders outside the range', async () => {
    const r = await u.admin.as.get('/api/orders?from=2000-01-01&to=2000-12-31');
    expect(r.body.total).toBe(0);
  });
});
