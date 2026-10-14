const { query, withTransaction } = require('../db/pool');
const { badRequest, forbidden, notFound, conflict } = require('../errors');
const config = require('../config');
const audit = require('./audit');
const { notify } = require('./notifications');
const clock = require('./clock');

/**
 * Panic-value acknowledgement + escalation chain (R-13, US-09):
 *   ORDERING physician --(window expires)--> ON_CALL physician(s) --(window expires)--> lab DIRECTOR
 * Escalation is driven by a periodic check (server.js) that uses the injectable clock,
 * so tests can jump past the window instantly.
 */

async function onCallPhysicians(db) {
  return (await db.query("SELECT id FROM users WHERE role = 'physician' AND is_on_call ORDER BY id")).rows.map((r) => r.id);
}

async function labDirectors(db) {
  const directors = (await db.query('SELECT id FROM users WHERE is_lab_director ORDER BY id')).rows.map((r) => r.id);
  if (directors.length) return directors;
  // Fallback so the chain never dead-ends: page every lab administrator.
  return (await db.query("SELECT id FROM users WHERE role = 'lab_admin' ORDER BY id")).rows.map((r) => r.id);
}

async function alertContext(db, alertId) {
  const { rows } = await db.query(
    `SELECT a.*, i.order_id, o.physician_id, o.patient_id, p.name AS patient_name, lt.name AS test_name
       FROM panic_alerts a
       JOIN order_items i ON i.id = a.order_item_id
       JOIN orders o ON o.id = i.order_id
       JOIN users p ON p.id = o.patient_id
       JOIN lab_tests lt ON lt.id = i.test_id
      WHERE a.id = $1`,
    [alertId]
  );
  return rows[0];
}

/** Called inside the result-entry transaction when a version is flagged panic. */
async function openPanicAlert(db, { versionId, item, order, testName, summary, actorId }) {
  const existing = await db.query("SELECT id FROM panic_alerts WHERE order_item_id = $1 AND status = 'OPEN'", [item.id]);
  if (existing.rows[0]) return existing.rows[0];

  const now = clock.now();
  const { rows } = await db.query(
    `INSERT INTO panic_alerts (result_version_id, order_item_id, stage, status, current_target_id, created_at, stage_started_at)
     VALUES ($1,$2,'ORDERING','OPEN',$3,$4,$4) RETURNING *`,
    [versionId, item.id, order.physician_id, now]
  );
  const alert = rows[0];
  await audit.record(db, { entityType: 'panic_alert', entityId: alert.id, action: 'PANIC_ALERT_OPENED', to: 'ORDERING', actorId, details: { orderItemId: item.id, versionId } });
  await notify(db, order.physician_id, {
    type: 'PANIC_VALUE',
    message: `PANIC VALUE: ${testName} = ${summary} on order #${order.id}. Acknowledge within ${Math.round(config.panic.ackWindowSeconds / 60)} min.`,
    entityType: 'panic_alert', entityId: alert.id,
  });
  return alert;
}

/**
 * Escalate every open alert whose current stage window has elapsed.
 * Returns the list of escalations performed (useful for tests and logs).
 */
async function checkEscalations(now = clock.now()) {
  const escalated = [];
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT * FROM panic_alerts WHERE status = 'OPEN' AND stage <> 'DIRECTOR' ORDER BY id FOR UPDATE SKIP LOCKED`
    );
    for (const alert of rows) {
      const windowSec = alert.stage === 'ORDERING' ? config.panic.ackWindowSeconds : config.panic.onCallWindowSeconds;
      const elapsed = (now.getTime() - new Date(alert.stage_started_at).getTime()) / 1000;
      if (elapsed < windowSec) continue;

      const ctx = await alertContext(db, alert.id);
      let nextStage = alert.stage === 'ORDERING' ? 'ON_CALL' : 'DIRECTOR';
      let targets = nextStage === 'ON_CALL' ? (await onCallPhysicians(db)).filter((id) => id !== ctx.physician_id) : [];
      let skipped = false;
      if (nextStage === 'ON_CALL' && targets.length === 0) {
        nextStage = 'DIRECTOR'; // nobody on call: go straight to the director
        skipped = true;
      }
      if (nextStage === 'DIRECTOR') targets = await labDirectors(db);

      await db.query('UPDATE panic_alerts SET stage = $2, stage_started_at = $3, current_target_id = $4 WHERE id = $1', [
        alert.id, nextStage, now, targets[0] || null,
      ]);
      await audit.record(db, {
        entityType: 'panic_alert', entityId: alert.id, action: 'ESCALATED', from: alert.stage, to: nextStage,
        actorId: null, details: { elapsedSeconds: Math.round(elapsed), targets, skippedOnCall: skipped },
      });
      await notify(db, targets, {
        type: 'PANIC_ESCALATION',
        message: `ESCALATED PANIC VALUE (${nextStage === 'ON_CALL' ? 'on-call' : 'lab director'}): ${ctx.test_name} for ${ctx.patient_name}, order #${ctx.order_id}, unacknowledged by ordering physician${nextStage === 'DIRECTOR' && !skipped ? ' and on-call physician' : ''}.`,
        entityType: 'panic_alert', entityId: alert.id,
      });
      escalated.push({ alertId: alert.id, from: alert.stage, to: nextStage, targets });
    }
  });
  return escalated;
}

function canAcknowledge(user, alert, orderingPhysicianId) {
  if (user.role === 'physician' && user.id === orderingPhysicianId) return true;
  if (user.role === 'physician' && user.is_on_call && alert.stage !== 'ORDERING') return true;
  if (user.is_lab_director && alert.stage === 'DIRECTOR') return true;
  if (user.role === 'lab_admin' && alert.stage === 'DIRECTOR' && user.id === alert.current_target_id) return true;
  return false;
}

async function acknowledge(user, alertId, note) {
  return withTransaction(async (db) => {
    const lock = await db.query('SELECT * FROM panic_alerts WHERE id = $1 FOR UPDATE', [alertId]);
    if (!lock.rows[0]) throw notFound('Panic alert');
    const ctx = await alertContext(db, alertId);
    if (ctx.status === 'ACKNOWLEDGED') throw conflict('Alert already acknowledged');
    if (!canAcknowledge(user, ctx, ctx.physician_id)) throw forbidden('You are not a current recipient of this panic alert');

    const now = clock.now();
    await db.query("UPDATE panic_alerts SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = $3 WHERE id = $1", [alertId, user.id, now]);
    await audit.record(db, {
      entityType: 'panic_alert', entityId: alertId, action: 'ACKNOWLEDGED', from: 'OPEN', to: 'ACKNOWLEDGED', actorId: user.id,
      details: { stage: ctx.stage, secondsSinceCreated: Math.round((now - new Date(ctx.created_at)) / 1000), note: note || null },
    });
    if (user.id !== ctx.physician_id) {
      await notify(db, ctx.physician_id, {
        type: 'PANIC_ACKNOWLEDGED',
        message: `Panic value on order #${ctx.order_id} (${ctx.test_name}) was acknowledged by ${user.name}.`,
        entityType: 'panic_alert', entityId: alertId,
      });
    }
    return { ...ctx, status: 'ACKNOWLEDGED', acknowledged_by: user.id, acknowledged_at: now };
  });
}

/** Alerts the caller is responsible for (or all, for admins). */
async function listAlerts(user, { status } = {}) {
  const where = [];
  const vals = [];
  if (status) {
    vals.push(String(status).toUpperCase());
    where.push(`a.status = $${vals.length}`);
  }
  if (user.role === 'physician') {
    vals.push(user.id);
    const me = `$${vals.length}`;
    where.push(`(o.physician_id = ${me}${user.is_on_call ? " OR a.stage IN ('ON_CALL','DIRECTOR')" : ''}${user.is_lab_director ? " OR a.stage = 'DIRECTOR'" : ''})`);
  } else if (user.role === 'lab_admin') {
    // admins see all alerts (monitoring)
  } else if (user.is_lab_director) {
    where.push("a.stage = 'DIRECTOR'");
  } else {
    throw forbidden();
  }
  const { rows } = await query(
    `SELECT a.*, i.order_id, lt.name AS test_name, p.name AS patient_name, d.name AS ordering_physician_name,
            rv.data AS result_data, ack.name AS acknowledged_by_name
       FROM panic_alerts a
       JOIN order_items i ON i.id = a.order_item_id
       JOIN orders o ON o.id = i.order_id
       JOIN lab_tests lt ON lt.id = i.test_id
       JOIN users p ON p.id = o.patient_id
       JOIN users d ON d.id = o.physician_id
       JOIN result_versions rv ON rv.id = a.result_version_id
       LEFT JOIN users ack ON ack.id = a.acknowledged_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (a.status = 'OPEN') DESC, a.created_at DESC
      LIMIT 200`,
    vals
  );
  return rows;
}

let timer = null;
function startScheduler(log = console) {
  if (timer) return;
  timer = setInterval(() => {
    checkEscalations().then(
      (done) => done.length && log.log(`[escalation] ${done.length} alert(s) escalated`),
      (err) => log.error('[escalation] check failed', err)
    );
  }, config.panic.pollSeconds * 1000);
  timer.unref();
}
function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { openPanicAlert, checkEscalations, acknowledge, listAlerts, startScheduler, stopScheduler, canAcknowledge };
