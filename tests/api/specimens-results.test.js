const { resetDb, loginAll, closePool, workflow, pool, testId } = require('../helpers/api');

let u;
beforeAll(async () => {
  await resetDb();
  u = await loginAll();
});
afterAll(closePool);

describe('R-06 / US-03 Specimen collection and accession numbers', () => {
  test('collection generates a unique, immutable accession linked to the order', async () => {
    const a = await workflow(u, { until: 'COLLECTED' });
    const b = await workflow(u, { until: 'COLLECTED' });
    expect(a.specimen.accession_number).toMatch(/^ML\d{8}-\d{6}$/);
    expect(a.specimen.accession_number).not.toBe(b.specimen.accession_number);
    expect(a.specimen.order_id).toBe(a.order.id);

    const o = await u.tech.as.get(`/api/orders/${a.order.id}`);
    expect(o.body.status).toBe('IN_PROGRESS');
    expect(o.body.items[0].status).toBe('COLLECTED');
    expect(o.body.items[0].accession_number).toBe(a.specimen.accession_number);
  });

  test('duplicate accession numbers are rejected by the database', async () => {
    const { rows } = await pool.query('SELECT order_id, accession_number, collected_by FROM specimens LIMIT 1');
    await expect(
      pool.query("INSERT INTO specimens (order_id, accession_number, status, collected_by) VALUES ($1,$2,'COLLECTED',$3)",
        [rows[0].order_id, rows[0].accession_number, rows[0].collected_by])
    ).rejects.toThrow(/duplicate key/);
  });

  test('cannot collect for an unassigned order or twice when nothing needs collection', async () => {
    const p = await workflow(u, { until: 'PENDING' });
    expect((await u.tech.as.post(`/api/orders/${p.order.id}/specimens`)).status).toBe(403);
    const c = await workflow(u, { until: 'COLLECTED' });
    const again = await u.tech.as.post(`/api/orders/${c.order.id}/specimens`);
    expect(again.status).toBe(409);
  });
});

describe('R-07 / R-14 Invalid transitions are rejected by the API', () => {
  test('result before collection', async () => {
    const ctx = await workflow(u, { until: 'ASSIGNED' });
    const r = await u.tech.as.post(`/api/order-items/${ctx.item.id}/results`).send({ data: { value: 90 } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_TRANSITION');
    expect(r.body.error.message).toMatch(/collected/);
  });

  test('result before processing starts', async () => {
    const ctx = await workflow(u, { until: 'COLLECTED' });
    expect((await u.tech.as.post(`/api/order-items/${ctx.item.id}/results`).send({ data: { value: 90 } })).status).toBe(409);
  });

  test('release before review (approve while RESULT_AVAILABLE)', async () => {
    const ctx = await workflow(u, { until: 'RESULT_AVAILABLE' });
    const r = await u.physician.as.post(`/api/order-items/${ctx.item.id}/review`).send({ decision: 'approve' });
    expect(r.status).toBe(409);
  });

  test('submit before any result exists', async () => {
    const ctx = await workflow(u, { until: 'IN_PROCESSING' });
    expect((await u.tech.as.post(`/api/order-items/${ctx.item.id}/submit`)).status).toBe(409);
  });

  test('order cannot be closed while a test is unreviewed', async () => {
    const ctx = await workflow(u, { codes: ['GLU', 'K'], until: 'UNDER_REVIEW' });
    await u.physician.as.post(`/api/order-items/${ctx.items[0].id}/review`).send({ decision: 'approve' });
    const r = await u.admin.as.post(`/api/orders/${ctx.order.id}/close`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/released or cancelled/);

    // cancelling the remaining test lets it auto-close
    await u.physician.as.post(`/api/order-items/${ctx.items[1].id}/cancel`).send({ reason: 'not needed' });
    expect((await u.admin.as.post(`/api/order-items/${ctx.items[1].id}/cancel`)).status).toBe(409); // already cancelled
  });

  test('order auto-closes once every test is released', async () => {
    const ctx = await workflow(u, { codes: ['GLU', 'NA'] });
    const o = await u.physician.as.get(`/api/orders/${ctx.order.id}`);
    expect(o.body.status).toBe('CLOSED');
    expect(o.body.closed_at).toBeTruthy();
  });
});

describe('R-08 Specimen rejection and recollection', () => {
  test('rejection returns tests to collection-required and notifies the physician', async () => {
    const ctx = await workflow(u, { codes: ['GLU', 'K'], until: 'IN_PROCESSING' });
    expect((await u.tech.as.post(`/api/specimens/${ctx.specimen.id}/reject`).send({})).status).toBe(400); // reason required

    const r = await u.tech.as.post(`/api/specimens/${ctx.specimen.id}/reject`).send({ reason: 'Hemolyzed' });
    expect(r.status).toBe(200);
    const o = await u.tech.as.get(`/api/orders/${ctx.order.id}`);
    expect(o.body.items.every((i) => i.status === 'COLLECTION_REQUIRED' && i.specimen_id === null)).toBe(true);
    expect(o.body.specimens[0].status).toBe('REJECTED');
    expect(o.body.specimens[0].rejection_reason).toBe('Hemolyzed');

    const n = await u.physician.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'SPECIMEN_REJECTED' && x.message.includes('Hemolyzed'))).toBe(true);

    // recollect -> new accession number
    const again = await u.tech.as.post(`/api/orders/${ctx.order.id}/specimens`);
    expect(again.status).toBe(201);
    expect(again.body.accession_number).not.toBe(ctx.specimen.accession_number);
    // rejected specimen cannot be rejected again
    expect((await u.tech.as.post(`/api/specimens/${ctx.specimen.id}/reject`).send({ reason: 'x' })).status).toBe(409);
  });
});

describe('R-09 Category-specific result entry', () => {
  test('quantitative, qualitative and culture each accepted with the right shape', async () => {
    const ctx = await workflow(u, { codes: ['GLU', 'HCG', 'UCX'], until: 'IN_PROCESSING' });
    const byCode = Object.fromEntries(ctx.items.map((i) => [i.test_code, i]));

    let r = await u.tech.as.post(`/api/order-items/${byCode.GLU.id}/results`).send({ data: { value: 130 } });
    expect(r.status).toBe(201);
    expect(r.body.abnormal_flag).toBe('H');
    expect(r.body.is_panic).toBe(false);

    r = await u.tech.as.post(`/api/order-items/${byCode.HCG.id}/results`).send({ data: { interpretation: 'Negative' } });
    expect(r.status).toBe(201);
    expect(r.body.data.interpretation).toBe('negative');

    r = await u.tech.as.post(`/api/order-items/${byCode.UCX.id}/results`).send({
      data: { growth: true, organism: 'E. coli', sensitivities: [{ antibiotic: 'Nitrofurantoin', interpretation: 'S' }, { antibiotic: 'Ampicillin', interpretation: 'R' }] },
    });
    expect(r.status).toBe(201);
    expect(r.body.data.sensitivities).toHaveLength(2);

    // wrong shape for category -> 400
    expect((await u.tech.as.post(`/api/order-items/${byCode.GLU.id}/results`).send({ data: { interpretation: 'positive' } })).status).toBe(400);
  });

  test('abnormal (non-panic) result notifies the ordering physician', async () => {
    const n = await u.physician.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'ABNORMAL_RESULT')).toBe(true);
  });

  test('only the assigned technician can enter results', async () => {
    const ctx = await workflow(u, { until: 'IN_PROCESSING' });
    expect((await u.tech2.as.post(`/api/order-items/${ctx.item.id}/results`).send({ data: { value: 1 } })).status).toBe(403);
  });
});

describe('R-10 Physician review: approve or return for retest', () => {
  test('return for retest re-enters processing and keeps the reason', async () => {
    const ctx = await workflow(u, { until: 'UNDER_REVIEW' });
    expect((await u.physician.as.post(`/api/order-items/${ctx.item.id}/review`).send({ decision: 'retest' })).status).toBe(400);
    const r = await u.physician.as.post(`/api/order-items/${ctx.item.id}/review`).send({ decision: 'retest', reason: 'Value inconsistent with prior' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('IN_PROCESSING');

    const o = await u.physician.as.get(`/api/orders/${ctx.order.id}`);
    expect(o.body.items[0].retest_reason).toBe('Value inconsistent with prior');
    const n = await u.tech.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'RETEST_REQUESTED')).toBe(true);

    // re-enter -> version 2
    const v2 = await u.tech.as.post(`/api/order-items/${ctx.item.id}/results`).send({ data: { value: 88 } });
    expect(v2.body.version).toBe(2);
  });

  test('only the ordering physician can review', async () => {
    const ctx = await workflow(u, { until: 'UNDER_REVIEW' });
    const r = await u.oncall.as.post(`/api/order-items/${ctx.item.id}/review`).send({ decision: 'approve' });
    expect(r.status).toBe(403);
  });

  test('release notifies the patient', async () => {
    await workflow(u);
    const n = await u.patient.as.get('/api/notifications');
    expect(n.body.notifications.some((x) => x.type === 'RESULT_RELEASED')).toBe(true);
  });
});

describe('R-11 / US-10 Released results are immutable; amendments are new versions', () => {
  test('amend creates a new version; both visible with superseded marker', async () => {
    const ctx = await workflow(u, { value: 85 });
    expect((await u.tech.as.post(`/api/order-items/${ctx.item.id}/amend`).send({ data: { value: 95 } })).status).toBe(400); // reason needed

    const a = await u.tech.as.post(`/api/order-items/${ctx.item.id}/amend`).send({ data: { value: 95 }, reason: 'Transcription error' });
    expect(a.status).toBe(201);
    expect(a.body.version).toBe(2);
    expect(a.body.is_amendment).toBe(true);

    const h = await u.physician.as.get(`/api/order-items/${ctx.item.id}/history`);
    expect(h.body.map((v) => [v.version, v.state])).toEqual([[1, 'SUPERSEDED'], [2, 'CURRENT']]);
    expect(h.body[0].data.value).toBe(85);
    expect(h.body[1].amendment_reason).toBe('Transcription error');

    const pn = await u.patient.as.get('/api/notifications');
    expect(pn.body.notifications.some((x) => x.type === 'RESULT_AMENDED')).toBe(true);
  });

  test('database refuses to UPDATE or DELETE a released version (defence in depth)', async () => {
    const { rows } = await pool.query('SELECT id FROM result_versions WHERE released_at IS NOT NULL LIMIT 1');
    await expect(pool.query(`UPDATE result_versions SET data = '{"value": 1}' WHERE id = $1`, [rows[0].id])).rejects.toThrow(/cannot be modified/);
    await expect(pool.query('DELETE FROM result_versions WHERE id = $1', [rows[0].id])).rejects.toThrow(/append-only/);
  });

  test('cannot amend a result that is not released', async () => {
    const ctx = await workflow(u, { until: 'UNDER_REVIEW' });
    expect((await u.tech.as.post(`/api/order-items/${ctx.item.id}/amend`).send({ data: { value: 1 }, reason: 'x' })).status).toBe(409);
  });
});

describe('Order cancellation', () => {
  test('physician cancels a pending order; all tests cancelled', async () => {
    const ctx = await workflow(u, { codes: ['GLU', 'K'], until: 'PENDING' });
    const r = await u.physician.as.post(`/api/orders/${ctx.order.id}/cancel`).send({ reason: 'Duplicate' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CANCELLED');
    expect(r.body.items.every((i) => i.status === 'CANCELLED')).toBe(true);
  });

  test('cannot cancel an order already in progress', async () => {
    const ctx = await workflow(u, { until: 'COLLECTED' });
    expect((await u.physician.as.post(`/api/orders/${ctx.order.id}/cancel`).send({})).status).toBe(409);
  });

  test('another physician cannot cancel my order', async () => {
    const ctx = await workflow(u, { until: 'PENDING' });
    expect((await u.oncall.as.post(`/api/orders/${ctx.order.id}/cancel`).send({})).status).toBe(403);
    await testId('GLU');
  });
});
