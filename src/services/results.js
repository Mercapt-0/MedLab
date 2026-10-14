const { query, withTransaction } = require('../db/pool');
const { ITEM } = require('../domain/stateMachine');
const { resultTypeFor } = require('../domain/resultTypes');
const { badRequest, forbidden, notFound, InvalidTransitionError } = require('../errors');
const { setItemStatus, maybeAutoClose } = require('./orders');
const { openPanicAlert } = require('./escalation');
const audit = require('./audit');
const { notify } = require('./notifications');
const clock = require('./clock');

async function lockItem(db, itemId) {
  const { rows } = await db.query(
    `SELECT i.*, o.physician_id, o.patient_id, o.assigned_technician_id, o.priority, o.id AS order_id,
            lt.code AS test_code, lt.name AS test_name, lt.category, lt.unit, lt.ref_low, lt.ref_high,
            lt.panic_low, lt.panic_high, lt.panic_on_positive
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN lab_tests lt ON lt.id = i.test_id
      WHERE i.id = $1
      FOR UPDATE OF i`,
    [itemId]
  );
  if (!rows[0]) throw notFound('Order item');
  return rows[0];
}

const testOf = (item) => ({
  category: item.category, unit: item.unit, ref_low: item.ref_low, ref_high: item.ref_high,
  panic_low: item.panic_low, panic_high: item.panic_high, panic_on_positive: item.panic_on_positive,
});

async function latestVersion(db, itemId) {
  const { rows } = await db.query('SELECT * FROM result_versions WHERE order_item_id = $1 ORDER BY version DESC LIMIT 1', [itemId]);
  return rows[0] || null;
}

/** Insert a new immutable version and raise abnormal / panic signals. */
async function appendVersion(db, item, user, data, { isAmendment = false, reason = null, release = false } = {}) {
  const type = resultTypeFor(testOf(item));
  const clean = type.validate(data);
  const { abnormalFlag, isPanic } = type.evaluate(clean);
  const prev = await latestVersion(db, item.id);
  const version = prev ? prev.version + 1 : 1;
  const now = clock.now();

  const { rows } = await db.query(
    `INSERT INTO result_versions (order_item_id, version, category, data, abnormal_flag, is_panic, entered_by, entered_at,
                                  is_amendment, amendment_reason, released_by, released_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [item.id, version, item.category, JSON.stringify(clean), abnormalFlag, isPanic, user.id, now,
     isAmendment, reason, release ? user.id : null, release ? now : null]
  );
  const v = rows[0];
  const summary = type.summarize(clean);

  await audit.record(db, {
    entityType: 'result', entityId: v.id, action: isAmendment ? 'AMENDED' : 'RESULT_ENTERED', actorId: user.id,
    details: { orderItemId: item.id, version, abnormalFlag, isPanic, reason },
  });

  if (isPanic) {
    await openPanicAlert(db, { versionId: v.id, item, order: { id: item.order_id, physician_id: item.physician_id }, testName: item.test_name, summary, actorId: user.id });
  } else if (abnormalFlag) {
    await notify(db, item.physician_id, {
      type: 'ABNORMAL_RESULT',
      message: `Abnormal result (${abnormalFlag}) for ${item.test_name} on order #${item.order_id}: ${summary}`,
      entityType: 'order', entityId: item.order_id,
    });
  }
  return { version: v, summary };
}

/** Technician enters (or re-enters, before submission) a category-specific result (R-09). */
async function enterResult(user, itemId, data) {
  return withTransaction(async (db) => {
    const item = await lockItem(db, itemId);
    if (user.role !== 'technician' || item.assigned_technician_id !== user.id) {
      throw forbidden('Only the assigned technician can enter results');
    }
    if (![ITEM.IN_PROCESSING, ITEM.RESULT_AVAILABLE].includes(item.status)) {
      throw new InvalidTransitionError('order item', item.status, ITEM.RESULT_AVAILABLE,
        `Cannot enter a result while the test is ${item.status}; the specimen must be collected and in processing first`);
    }
    const { version } = await appendVersion(db, item, user, data);
    await setItemStatus(db, item, ITEM.RESULT_AVAILABLE, user.id, { action: 'RESULT_AVAILABLE', details: { version: version.version } });
    return version;
  });
}

/** Technician submits the latest result for physician review. */
async function submitForReview(user, itemId) {
  return withTransaction(async (db) => {
    const item = await lockItem(db, itemId);
    if (user.role !== 'technician' || item.assigned_technician_id !== user.id) throw forbidden('Only the assigned technician can submit results');
    await setItemStatus(db, item, ITEM.UNDER_REVIEW, user.id, { action: 'SUBMITTED_FOR_REVIEW' });
    await notify(db, item.physician_id, {
      type: 'RESULT_AVAILABLE',
      message: `${item.test_name} result for order #${item.order_id} is ready for your review`,
      entityType: 'order', entityId: item.order_id,
    });
    return { id: item.id, status: item.status };
  });
}

/** Ordering physician approves for release, or returns for retest with a reason (R-10). */
async function review(user, itemId, { decision, reason }) {
  if (!['approve', 'retest'].includes(decision)) throw badRequest('decision must be "approve" or "retest"');
  if (decision === 'retest' && !(reason && String(reason).trim())) throw badRequest('A reason is required when returning for retest');

  return withTransaction(async (db) => {
    const item = await lockItem(db, itemId);
    if (user.role !== 'physician' || item.physician_id !== user.id) throw forbidden('Only the ordering physician can review this result');
    if (item.status !== ITEM.UNDER_REVIEW) {
      throw new InvalidTransitionError('order item', item.status, decision === 'approve' ? ITEM.RELEASED : ITEM.IN_PROCESSING,
        'Only results under review can be released or returned for retest');
    }
    const v = await latestVersion(db, item.id);
    const now = clock.now();

    if (decision === 'approve') {
      await db.query('UPDATE result_versions SET released_by = $2, released_at = $3 WHERE id = $1', [v.id, user.id, now]);
      await setItemStatus(db, item, ITEM.RELEASED, user.id, { action: 'RELEASED', sets: { released_at: now }, details: { version: v.version } });
      await notify(db, item.patient_id, {
        type: 'RESULT_RELEASED',
        message: `Your ${item.test_name} result is now available`,
        entityType: 'order', entityId: item.order_id,
      });
      await maybeAutoClose(db, item.order_id, user.id);
    } else {
      await setItemStatus(db, item, ITEM.IN_PROCESSING, user.id, { action: 'RETURNED_FOR_RETEST', sets: { retest_reason: reason }, details: { reason, version: v.version } });
      await notify(db, item.assigned_technician_id, {
        type: 'RETEST_REQUESTED',
        message: `${item.test_name} on order #${item.order_id} was returned for retest: ${reason}`,
        entityType: 'order', entityId: item.order_id,
      });
    }
    return { id: item.id, status: item.status };
  });
}

/**
 * Amend a released result (R-11). Never overwrites: a new version is appended and
 * released immediately; the previous released version becomes "superseded".
 */
async function amend(user, itemId, { data, reason }) {
  if (!(reason && String(reason).trim())) throw badRequest('An amendment reason is required');
  return withTransaction(async (db) => {
    const item = await lockItem(db, itemId);
    const allowed =
      (user.role === 'technician' && item.assigned_technician_id === user.id) ||
      (user.role === 'physician' && item.physician_id === user.id);
    if (!allowed) throw forbidden('Only the assigned technician or ordering physician can amend this result');
    if (item.status !== ITEM.RELEASED) {
      throw new InvalidTransitionError('order item', item.status, 'AMENDED', 'Only released results can be amended; edit the draft instead');
    }
    const { version, summary } = await appendVersion(db, item, user, data, { isAmendment: true, reason, release: true });
    const recipients = [item.patient_id, item.physician_id].filter((id) => id !== user.id);
    await notify(db, recipients, {
      type: 'RESULT_AMENDED',
      message: `${item.test_name} result on order #${item.order_id} was amended (v${version.version}): ${summary}. Reason: ${reason}`,
      entityType: 'order', entityId: item.order_id,
    });
    return version;
  });
}

/** Full version history for one test. Patients see released versions only. */
async function history(user, itemId) {
  const item = (await query('SELECT i.*, o.patient_id, o.physician_id, o.assigned_technician_id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = $1', [itemId])).rows[0];
  if (!item) throw notFound('Order item');
  const ok =
    user.role === 'lab_admin' ||
    (user.role === 'physician') ||
    (user.role === 'technician' && item.assigned_technician_id === user.id) ||
    (user.role === 'patient' && item.patient_id === user.id);
  if (!ok) throw forbidden();

  const { rows } = await query(
    `SELECT v.*, e.name AS entered_by_name, r.name AS released_by_name
       FROM result_versions v
       JOIN users e ON e.id = v.entered_by
       LEFT JOIN users r ON r.id = v.released_by
      WHERE v.order_item_id = $1
      ${user.role === 'patient' ? 'AND v.released_at IS NOT NULL' : ''}
      ORDER BY v.version`,
    [itemId]
  );
  return decorateVersions(rows);
}

/** Mark released versions superseded when a later released version exists. */
function decorateVersions(rows) {
  const released = rows.filter((v) => v.released_at);
  const latestReleasedId = released.length ? released[released.length - 1].id : null;
  return rows.map((v) => ({
    ...v,
    state: v.released_at ? (v.id === latestReleasedId ? 'CURRENT' : 'SUPERSEDED') : 'DRAFT',
  }));
}

module.exports = { enterResult, submitForReview, review, amend, history, decorateVersions, lockItem };
