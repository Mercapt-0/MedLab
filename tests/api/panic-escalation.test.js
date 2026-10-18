const { resetDb, loginAll, closePool, workflow, clock, pool } = require('../helpers/api');
const { checkEscalations } = require('../../backend/src/services/escalation');

// Windows from helpers/env.js: ordering 600s, on-call 300s.
const MIN = 60 * 1000;

let u;
beforeEach(async () => {
  await resetDb();
  u = await loginAll();
  clock.setNow('2026-10-01T12:00:00Z');
});
afterEach(() => clock.reset());
afterAll(closePool);

async function panicGlucose(value = 35) {
  const ctx = await workflow(u, { codes: ['GLU'], until: 'RESULT_AVAILABLE', value });
  const alerts = await u.physician.as.get('/api/panic-alerts?status=OPEN');
  return { ctx, alert: alerts.body.find((a) => a.order_item_id === ctx.item.id) };
}

describe('R-13 / US-09 Panic-value acknowledgement and escalation', () => {
  test('a panic value opens an alert at ORDERING stage and pages the ordering physician', async () => {
    const { alert } = await panicGlucose();
    expect(alert).toBeDefined();
    expect(alert.stage).toBe('ORDERING');
    expect(alert.status).toBe('OPEN');
    const n = await u.physician.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'PANIC_VALUE' && /PANIC VALUE/.test(x.message))).toBe(true);
  });

  test('no escalation before the window elapses', async () => {
    await panicGlucose();
    clock.advance(9 * MIN);
    expect(await checkEscalations(clock.now())).toEqual([]);
  });

  test('escalates to on-call, then to lab director, when unacknowledged; every step audited', async () => {
    const { alert } = await panicGlucose();

    clock.advance(10 * MIN + 1000);
    const step1 = await checkEscalations(clock.now());
    expect(step1).toEqual([{ alertId: alert.id, from: 'ORDERING', to: 'ON_CALL', targets: [u.oncall.user.id] }]);
    let n = await u.oncall.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'PANIC_ESCALATION' && /on-call/.test(x.message))).toBe(true);

    // still within on-call window -> nothing
    clock.advance(4 * MIN);
    expect(await checkEscalations(clock.now())).toEqual([]);

    clock.advance(1 * MIN + 1000);
    const step2 = await checkEscalations(clock.now());
    expect(step2[0]).toMatchObject({ alertId: alert.id, from: 'ON_CALL', to: 'DIRECTOR', targets: [u.director.user.id] });
    n = await u.director.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'PANIC_ESCALATION' && /lab director/.test(x.message))).toBe(true);

    const audit = await pool.query("SELECT action, from_state, to_state FROM audit_log WHERE entity_type = 'panic_alert' AND entity_id = $1 ORDER BY id", [alert.id]);
    expect(audit.rows.map((r) => `${r.action}:${r.from_state || ''}->${r.to_state}`)).toEqual([
      'PANIC_ALERT_OPENED:->ORDERING',
      'ESCALATED:ORDERING->ON_CALL',
      'ESCALATED:ON_CALL->DIRECTOR',
    ]);

    // no further escalation beyond director
    clock.advance(60 * MIN);
    expect(await checkEscalations(clock.now())).toEqual([]);
  });

  test('timely acknowledgement by the ordering physician stops escalation', async () => {
    const { alert } = await panicGlucose();
    clock.advance(5 * MIN);
    const ack = await u.physician.as.post(`/api/panic-alerts/${alert.id}/acknowledge`).send({ note: 'Called patient' });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('ACKNOWLEDGED');
    clock.advance(60 * MIN);
    expect(await checkEscalations(clock.now())).toEqual([]);
    expect((await u.physician.as.post(`/api/panic-alerts/${alert.id}/acknowledge`)).status).toBe(409);
  });

  test('on-call physician can acknowledge only after escalation reaches them', async () => {
    const { alert } = await panicGlucose();
    expect((await u.oncall.as.post(`/api/panic-alerts/${alert.id}/acknowledge`)).status).toBe(403);
    clock.advance(11 * MIN);
    await checkEscalations(clock.now());
    expect((await u.oncall.as.post(`/api/panic-alerts/${alert.id}/acknowledge`)).status).toBe(200);
    const n = await u.physician.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'PANIC_ACKNOWLEDGED')).toBe(true);
  });

  test('the director can acknowledge at DIRECTOR stage; patients and technicians never can', async () => {
    const { alert } = await panicGlucose();
    expect((await u.director.as.post(`/api/panic-alerts/${alert.id}/acknowledge`)).status).toBe(403);
    clock.advance(11 * MIN); await checkEscalations(clock.now());
    clock.advance(6 * MIN); await checkEscalations(clock.now());
    expect((await u.patient.as.post(`/api/panic-alerts/${alert.id}/acknowledge`)).status).toBe(403);
    expect((await u.tech.as.post(`/api/panic-alerts/${alert.id}/acknowledge`)).status).toBe(403);
    expect((await u.director.as.post(`/api/panic-alerts/${alert.id}/acknowledge`)).status).toBe(200);
  });

  test('if nobody is on call, escalation skips straight to the director', async () => {
    await pool.query('UPDATE users SET is_on_call = FALSE');
    const { alert } = await panicGlucose();
    clock.advance(11 * MIN);
    const step = await checkEscalations(clock.now());
    expect(step[0]).toMatchObject({ alertId: alert.id, from: 'ORDERING', to: 'DIRECTOR' });
  });

  test('NFR-04: escalation fires even if the physician never opened the notification', async () => {
    await panicGlucose();
    const unread = await pool.query("SELECT COUNT(*)::int c FROM notifications WHERE type = 'PANIC_VALUE' AND read_at IS NULL");
    expect(unread.rows[0].c).toBe(1);
    clock.advance(11 * MIN);
    expect(await checkEscalations(clock.now())).toHaveLength(1);
  });

  test('re-entering a panic value before submission does not open a duplicate alert', async () => {
    const { ctx } = await panicGlucose(30);
    await u.tech.as.post(`/api/order-items/${ctx.item.id}/results`).send({ data: { value: 28 } });
    const { rows } = await pool.query('SELECT COUNT(*)::int c FROM panic_alerts WHERE order_item_id = $1', [ctx.item.id]);
    expect(rows[0].c).toBe(1);
  });

  test('positive blood culture (panic_on_positive) raises a panic alert', async () => {
    const ctx = await workflow(u, { codes: ['BCX'], until: 'IN_PROCESSING' });
    await u.tech.as.post(`/api/order-items/${ctx.item.id}/results`).send({
      data: { growth: true, organism: 'S. aureus', sensitivities: [{ antibiotic: 'Vancomycin', interpretation: 'S' }] },
    });
    const alerts = await u.physician.as.get('/api/panic-alerts');
    expect(alerts.body.some((a) => a.order_item_id === ctx.item.id)).toBe(true);
  });

  test('alert list is scoped: a physician without involvement sees nothing', async () => {
    await panicGlucose();
    const r = await u.admin.as.post('/api/users').send({ name: 'Dr Other', email: 'other@medlab.test', password: 'Password123!', role: 'physician' });
    expect(r.status).toBe(201);
    const login = await require('../helpers/api').request(require('../helpers/api').app)
      .post('/api/auth/login').send({ email: 'other@medlab.test', password: 'Password123!' });
    const other = require('../helpers/api').as(login.body.token);
    expect((await other.get('/api/panic-alerts')).body).toEqual([]);
  });
});
