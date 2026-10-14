const { query, withTransaction } = require('../db/pool');
const { orderMachine, orderItemMachine, ITEM, panelStatus, canCloseOrder } = require('../domain/stateMachine');
const { badRequest, forbidden, notFound, conflict, InvalidTransitionError } = require('../errors');
const audit = require('./audit');
const { notify, usersWithRole } = require('./notifications');
const clock = require('./clock');

async function lockOrder(db, orderId) {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!rows[0]) throw notFound('Order');
  return rows[0];
}

async function setOrderStatus(db, order, to, actorId, extra = {}) {
  orderMachine.assertTransition(order.status, to);
  await db.query('UPDATE orders SET status = $2, closed_at = $3 WHERE id = $1', [
    order.id,
    to,
    to === 'CLOSED' ? clock.now() : order.closed_at,
  ]);
  await audit.record(db, { entityType: 'order', entityId: order.id, action: extra.action || 'STATUS_CHANGE', from: order.status, to, actorId, details: extra.details });
  order.status = to;
}

async function setItemStatus(db, item, to, actorId, { action = 'STATUS_CHANGE', details, sets = {} } = {}) {
  orderItemMachine.assertTransition(item.status, to);
  const cols = ['status = $2'];
  const vals = [item.id, to];
  for (const [k, v] of Object.entries(sets)) {
    vals.push(v);
    cols.push(`${k} = $${vals.length}`);
  }
  await db.query(`UPDATE order_items SET ${cols.join(', ')} WHERE id = $1`, vals);
  await audit.record(db, { entityType: 'order_item', entityId: item.id, action, from: item.status, to, actorId, details });
  item.status = to;
}

// ---------------------------------------------------------------- create
async function createOrder(user, { patientId, priority = 'routine', testIds = [], panelIds = [], notes }) {
  if (!['routine', 'stat'].includes(priority)) throw badRequest('priority must be "routine" or "stat"');
  testIds = [...new Set((testIds || []).map(Number))];
  panelIds = [...new Set((panelIds || []).map(Number))];
  if (testIds.length === 0 && panelIds.length === 0) throw badRequest('Select at least one test or panel');

  return withTransaction(async (db) => {
    const p = await db.query("SELECT id, name FROM users WHERE id = $1 AND role = 'patient'", [patientId]);
    if (!p.rows[0]) throw badRequest('patientId must reference a patient');

    if (testIds.length) {
      const t = await db.query('SELECT id FROM lab_tests WHERE id = ANY($1) AND active', [testIds]);
      if (t.rowCount !== testIds.length) throw badRequest('One or more tests are unknown or inactive');
    }
    const panels = panelIds.length
      ? (await db.query('SELECT id FROM panels WHERE id = ANY($1) AND active', [panelIds])).rows
      : [];
    if (panels.length !== panelIds.length) throw badRequest('One or more panels are unknown or inactive');

    const now = clock.now();
    const { rows } = await db.query(
      `INSERT INTO orders (patient_id, physician_id, priority, notes, created_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [patientId, user.id, priority, notes || null, now]
    );
    const order = rows[0];

    for (const testId of testIds) {
      await db.query('INSERT INTO order_items (order_id, test_id) VALUES ($1,$2)', [order.id, testId]);
    }
    for (const panelId of panelIds) {
      const op = await db.query('INSERT INTO order_panels (order_id, panel_id) VALUES ($1,$2) RETURNING id', [order.id, panelId]);
      const comps = await db.query('SELECT test_id FROM panel_tests WHERE panel_id = $1', [panelId]);
      if (comps.rowCount === 0) throw badRequest(`Panel ${panelId} has no component tests`);
      for (const c of comps.rows) {
        await db.query('INSERT INTO order_items (order_id, test_id, order_panel_id) VALUES ($1,$2,$3)', [order.id, c.test_id, op.rows[0].id]);
      }
    }

    await audit.record(db, { entityType: 'order', entityId: order.id, action: 'CREATED', to: 'PENDING', actorId: user.id, details: { priority, testIds, panelIds } });
    await notify(db, await usersWithRole(db, 'lab_admin'), {
      type: 'ORDER_PLACED',
      message: `New ${priority.toUpperCase()} order #${order.id} for ${p.rows[0].name} awaiting assignment`,
      entityType: 'order',
      entityId: order.id,
    });
    return order;
  }).then((o) => getOrder(user, o.id));
}

// ---------------------------------------------------------------- assign
async function assignOrder(user, orderId, technicianId) {
  await withTransaction(async (db) => {
    const order = await lockOrder(db, orderId);
    const t = await db.query("SELECT id, name FROM users WHERE id = $1 AND role = 'technician'", [technicianId]);
    if (!t.rows[0]) throw badRequest('technicianId must reference a technician');
    if (order.assigned_technician_id === Number(technicianId)) throw conflict('Order is already assigned to that technician');

    const previous = order.assigned_technician_id;
    const to = order.status === 'PENDING' ? 'ASSIGNED' : order.status;
    orderMachine.assertTransition(order.status, to, `Cannot assign an order that is ${order.status}`);
    await db.query('UPDATE orders SET assigned_technician_id = $2, status = $3 WHERE id = $1', [order.id, technicianId, to]);
    await audit.record(db, {
      entityType: 'order', entityId: order.id, action: previous ? 'REASSIGNED' : 'ASSIGNED',
      from: order.status, to, actorId: user.id, details: { fromTechnicianId: previous, toTechnicianId: Number(technicianId) },
    });
    await notify(db, technicianId, {
      type: 'ORDER_ASSIGNED',
      message: `Order #${order.id} (${order.priority.toUpperCase()}) has been assigned to you`,
      entityType: 'order', entityId: order.id,
    });
    if (previous) {
      await notify(db, previous, { type: 'ORDER_REASSIGNED', message: `Order #${order.id} was reassigned to another technician`, entityType: 'order', entityId: order.id });
    }
  });
  return getOrder(user, orderId);
}

// ---------------------------------------------------------------- close / cancel
async function closeOrder(user, orderId) {
  await withTransaction(async (db) => {
    const order = await lockOrder(db, orderId);
    const { rows } = await db.query('SELECT status FROM order_items WHERE order_id = $1', [orderId]);
    if (!canCloseOrder(rows.map((r) => r.status))) {
      throw new InvalidTransitionError('order', order.status, 'CLOSED', 'Order cannot be closed until every test is released or cancelled');
    }
    await setOrderStatus(db, order, 'CLOSED', user.id, { action: 'CLOSED' });
  });
  return getOrder(user, orderId);
}

/** Close automatically once every item is released/cancelled. */
async function maybeAutoClose(db, orderId, actorId) {
  const order = (await db.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  const { rows } = await db.query('SELECT status FROM order_items WHERE order_id = $1', [orderId]);
  if (order.status === 'IN_PROGRESS' && canCloseOrder(rows.map((r) => r.status))) {
    await setOrderStatus(db, order, 'CLOSED', actorId, { action: 'AUTO_CLOSED' });
  }
}

async function cancelItem(user, itemId, reason) {
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      'SELECT i.*, o.physician_id, o.status AS order_status FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = $1 FOR UPDATE OF i',
      [itemId]
    );
    const item = rows[0];
    if (!item) throw notFound('Order item');
    if (user.role === 'physician' && item.physician_id !== user.id) throw forbidden();
    await setItemStatus(db, item, ITEM.CANCELLED, user.id, { action: 'CANCELLED', details: { reason } });
    await maybeAutoClose(db, item.order_id, user.id);
  });
}

async function cancelOrder(user, orderId, reason) {
  await withTransaction(async (db) => {
    const order = await lockOrder(db, orderId);
    if (user.role === 'physician' && order.physician_id !== user.id) throw forbidden();
    await setOrderStatus(db, order, 'CANCELLED', user.id, { action: 'CANCELLED', details: { reason } });
    const items = (await db.query("SELECT * FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED'", [orderId])).rows;
    for (const item of items) await setItemStatus(db, item, ITEM.CANCELLED, user.id, { action: 'CANCELLED', details: { reason } });
  });
  return getOrder(user, orderId);
}

// ---------------------------------------------------------------- read
function assertCanView(user, order) {
  if (user.role === 'lab_admin') return;
  if (user.role === 'physician' && (order.physician_id === user.id || user.is_on_call || user.is_lab_director)) return;
  if (user.role === 'technician' && order.assigned_technician_id === user.id) return;
  if (user.role === 'patient' && order.patient_id === user.id) return;
  throw forbidden();
}

async function getOrder(user, orderId) {
  const { rows } = await query(
    `SELECT o.*, p.name AS patient_name, p.date_of_birth AS patient_dob, d.name AS physician_name, t.name AS technician_name
       FROM orders o
       JOIN users p ON p.id = o.patient_id
       JOIN users d ON d.id = o.physician_id
       LEFT JOIN users t ON t.id = o.assigned_technician_id
      WHERE o.id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw notFound('Order');
  assertCanView(user, order);

  const items = (
    await query(
      `SELECT i.*, lt.code AS test_code, lt.name AS test_name, lt.category, lt.unit, lt.ref_low, lt.ref_high,
              s.accession_number,
              rv.id AS latest_version_id, rv.version AS latest_version, rv.data AS latest_data,
              rv.abnormal_flag, rv.is_panic, rv.released_at AS latest_released_at, rv.is_amendment
         FROM order_items i
         JOIN lab_tests lt ON lt.id = i.test_id
         LEFT JOIN specimens s ON s.id = i.specimen_id
         LEFT JOIN LATERAL (
           SELECT * FROM result_versions v WHERE v.order_item_id = i.id
            ${user.role === 'patient' ? 'AND v.released_at IS NOT NULL' : ''}
            ORDER BY v.version DESC LIMIT 1
         ) rv ON TRUE
        WHERE i.order_id = $1
        ORDER BY i.id`,
      [orderId]
    )
  ).rows;

  // Patients only see results once released.
  if (user.role === 'patient') {
    for (const it of items) {
      if (it.status !== ITEM.RELEASED) {
        it.latest_data = null; it.abnormal_flag = null; it.is_panic = false; it.latest_version_id = null;
      }
    }
  }

  const panels = (
    await query(
      `SELECT op.id, pa.code, pa.name FROM order_panels op JOIN panels pa ON pa.id = op.panel_id WHERE op.order_id = $1`,
      [orderId]
    )
  ).rows.map((p) => {
    const comps = items.filter((i) => i.order_panel_id === p.id);
    return { ...p, status: panelStatus(comps.map((c) => c.status)), components: comps.map((c) => c.id) };
  });

  const specimens = (await query('SELECT * FROM specimens WHERE order_id = $1 ORDER BY id', [orderId])).rows;
  return { ...order, items, panels, specimens };
}

/**
 * Search / filter orders (R-17), scoped to what the caller may see.
 * Filters: patient (name or id), test (code or name), physician (name or id), from, to, status, priority.
 */
async function searchOrders(user, f = {}) {
  const where = [];
  const vals = [];
  const add = (sql, v) => {
    vals.push(v);
    where.push(sql.replace('?', `$${vals.length}`));
  };

  if (user.role === 'physician') add('o.physician_id = ?', user.id);
  if (user.role === 'technician') add('o.assigned_technician_id = ?', user.id);
  if (user.role === 'patient') add('o.patient_id = ?', user.id);

  if (f.patient) {
    if (/^\d+$/.test(f.patient)) add('o.patient_id = ?', Number(f.patient));
    else add('p.name ILIKE ?', `%${f.patient}%`);
  }
  if (f.physician) {
    if (/^\d+$/.test(f.physician)) add('o.physician_id = ?', Number(f.physician));
    else add('d.name ILIKE ?', `%${f.physician}%`);
  }
  if (f.test) {
    vals.push(`%${f.test}%`);
    const n = vals.length;
    where.push(`EXISTS (SELECT 1 FROM order_items fi JOIN lab_tests ft ON ft.id = fi.test_id
                  WHERE fi.order_id = o.id AND (ft.code ILIKE $${n} OR ft.name ILIKE $${n}))`);
  }
  if (f.status) add('o.status = ?', String(f.status).toUpperCase());
  if (f.priority) add('o.priority = ?', String(f.priority).toLowerCase());
  if (f.from) add('o.created_at >= ?', new Date(f.from));
  if (f.to) {
    const to = new Date(f.to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.to))) to.setUTCDate(to.getUTCDate() + 1); // inclusive date
    add('o.created_at < ?', to);
  }
  if (f.unassigned === 'true') where.push('o.assigned_technician_id IS NULL');

  const limit = Math.min(Number(f.limit) || 50, 200);
  const offset = Number(f.offset) || 0;
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT o.id, o.priority, o.status, o.created_at, o.closed_at,
            o.patient_id, p.name AS patient_name, o.physician_id, d.name AS physician_name,
            o.assigned_technician_id, t.name AS technician_name,
            (SELECT json_agg(json_build_object('id', i.id, 'code', lt.code, 'status', i.status) ORDER BY i.id)
               FROM order_items i JOIN lab_tests lt ON lt.id = i.test_id WHERE i.order_id = o.id) AS items,
            COUNT(*) OVER() AS total
       FROM orders o
       JOIN users p ON p.id = o.patient_id
       JOIN users d ON d.id = o.physician_id
       LEFT JOIN users t ON t.id = o.assigned_technician_id
       ${whereSql}
      ORDER BY (o.priority = 'stat' AND o.status NOT IN ('CLOSED','CANCELLED')) DESC, o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    vals
  );
  const total = rows[0] ? Number(rows[0].total) : 0;
  return { total, limit, offset, orders: rows.map(({ total: _t, ...r }) => r) };
}

module.exports = {
  createOrder, assignOrder, closeOrder, cancelOrder, cancelItem, getOrder, searchOrders,
  setItemStatus, setOrderStatus, lockOrder, maybeAutoClose, assertCanView,
};
