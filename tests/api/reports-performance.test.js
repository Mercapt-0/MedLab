const { resetDb, loginAll, closePool, workflow, clock, pool } = require('../helpers/api');

let u;
beforeAll(async () => {
  await resetDb({ bulk: true }); // 5,000 historical orders
  u = await loginAll();
});
afterAll(async () => {
  clock.reset();
  await closePool();
});

describe('R-18 Turnaround-time report', () => {
  test('displayed figures match actual vs expected TAT for a known sample', async () => {
    // A routine GLU order released exactly 3h after ordering; GLU routine target = 4h.
    clock.setNow('2030-01-01T08:00:00Z');
    const ctx = await workflow(u, { codes: ['GLU'], until: 'UNDER_REVIEW' });
    clock.setNow('2030-01-01T11:00:00Z');
    await u.physician.as.post(`/api/order-items/${ctx.item.id}/review`).send({ decision: 'approve' });
    clock.reset();

    const r = await u.admin.as.get('/api/reports/turnaround?from=2030-01-01&to=2030-01-01');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      expect.objectContaining({ code: 'GLU', priority: 'routine', completed: 1, avg_hours: 3, target_hours: 4, pct_within_target: 100 }),
    ]);
  });

  test('report breaks down by test and priority across bulk history', async () => {
    const r = await u.admin.as.get('/api/reports/turnaround');
    const keys = new Set(r.body.map((x) => `${x.code}/${x.priority}`));
    expect(keys.has('GLU/stat')).toBe(true);
    expect(keys.has('GLU/routine')).toBe(true);
    const total = r.body.reduce((s, x) => s + x.completed, 0);
    expect(total).toBeGreaterThanOrEqual(5000);
  });
});

describe('NFR-02 Performance', () => {
  test('filtered order search over >= 5,000 orders returns in under 2 seconds', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int c FROM orders');
    expect(rows[0].c).toBeGreaterThanOrEqual(5000);
    const t0 = Date.now();
    const r = await u.admin.as.get('/api/orders?test=GLU&status=CLOSED&patient=Riya&limit=50');
    const ms = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });

  test('notification is visible immediately after the triggering event (< 30s target)', async () => {
    const t0 = Date.now();
    const ctx = await workflow(u, { until: 'ASSIGNED' });
    const n = await u.tech.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.entity_id === ctx.order.id && x.type === 'ORDER_ASSIGNED')).toBe(true);
    expect(Date.now() - t0).toBeLessThan(30000);
  });
});
