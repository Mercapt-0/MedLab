const { withTransaction } = require('../db/pool');
const { specimenMachine, ITEM } = require('../domain/stateMachine');
const { badRequest, forbidden, notFound, InvalidTransitionError } = require('../errors');
const { lockOrder, setItemStatus, setOrderStatus } = require('./orders');
const audit = require('./audit');
const { notify } = require('./notifications');
const clock = require('./clock');

/** Accession format: MLyyyymmdd-000123 - unique by DB constraint + sequence (R-06). */
async function nextAccessionNumber(db) {
  const { rows } = await db.query("SELECT nextval('accession_seq') AS n");
  const d = clock.now();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `ML${ymd}-${String(rows[0].n).padStart(6, '0')}`;
}

function assertAssignedTech(user, order) {
  if (user.role !== 'technician' || order.assigned_technician_id !== user.id) {
    throw forbidden('Only the technician assigned to this order can handle its specimens');
  }
}

/** Record collection of a specimen covering every test that currently needs collection. */
async function collectSpecimen(user, orderId) {
  return withTransaction(async (db) => {
    const order = await lockOrder(db, orderId);
    assertAssignedTech(user, order);
    if (!['ASSIGNED', 'IN_PROGRESS'].includes(order.status)) {
      throw new InvalidTransitionError('order', order.status, 'IN_PROGRESS', `Cannot collect a specimen for an order that is ${order.status}`);
    }
    const items = (
      await db.query("SELECT * FROM order_items WHERE order_id = $1 AND status = 'COLLECTION_REQUIRED' FOR UPDATE", [orderId])
    ).rows;
    if (items.length === 0) {
      throw new InvalidTransitionError('order item', 'n/a', ITEM.COLLECTED, 'No tests on this order currently require collection');
    }

    const accession = await nextAccessionNumber(db);
    const { rows } = await db.query(
      `INSERT INTO specimens (order_id, accession_number, status, collected_by, collected_at)
       VALUES ($1,$2,'COLLECTED',$3,$4) RETURNING *`,
      [orderId, accession, user.id, clock.now()]
    );
    const specimen = rows[0];
    await audit.record(db, { entityType: 'specimen', entityId: specimen.id, action: 'COLLECTED', to: 'COLLECTED', actorId: user.id, details: { accession, orderId } });

    for (const item of items) {
      await setItemStatus(db, item, ITEM.COLLECTED, user.id, { action: 'COLLECTED', sets: { specimen_id: specimen.id }, details: { accession } });
    }
    if (order.status === 'ASSIGNED') await setOrderStatus(db, order, 'IN_PROGRESS', user.id);
    return specimen;
  });
}

async function lockSpecimen(db, specimenId) {
  const { rows } = await db.query('SELECT * FROM specimens WHERE id = $1 FOR UPDATE', [specimenId]);
  if (!rows[0]) throw notFound('Specimen');
  return rows[0];
}

/** COLLECTED -> IN_PROCESSING for the specimen and all of its tests. */
async function startProcessing(user, specimenId) {
  return withTransaction(async (db) => {
    const specimen = await lockSpecimen(db, specimenId);
    const order = await lockOrder(db, specimen.order_id);
    assertAssignedTech(user, order);
    specimenMachine.assertTransition(specimen.status, 'IN_PROCESSING');

    await db.query("UPDATE specimens SET status = 'IN_PROCESSING' WHERE id = $1", [specimen.id]);
    await audit.record(db, { entityType: 'specimen', entityId: specimen.id, action: 'PROCESSING_STARTED', from: specimen.status, to: 'IN_PROCESSING', actorId: user.id });

    const items = (await db.query("SELECT * FROM order_items WHERE specimen_id = $1 AND status = 'COLLECTED' FOR UPDATE", [specimen.id])).rows;
    for (const item of items) await setItemStatus(db, item, ITEM.IN_PROCESSING, user.id);
    return { ...specimen, status: 'IN_PROCESSING' };
  });
}

/**
 * Reject a specimen with a documented reason (R-08). Affected tests go back to
 * COLLECTION_REQUIRED so a new specimen can be drawn; the physician is notified.
 */
async function rejectSpecimen(user, specimenId, reason) {
  if (!reason || !String(reason).trim()) throw badRequest('A rejection reason is required');
  return withTransaction(async (db) => {
    const specimen = await lockSpecimen(db, specimenId);
    const order = await lockOrder(db, specimen.order_id);
    assertAssignedTech(user, order);
    specimenMachine.assertTransition(specimen.status, 'REJECTED');

    const items = (
      await db.query(
        "SELECT * FROM order_items WHERE specimen_id = $1 AND status IN ('COLLECTED','IN_PROCESSING') FOR UPDATE",
        [specimen.id]
      )
    ).rows;

    await db.query("UPDATE specimens SET status = 'REJECTED', rejection_reason = $2, rejected_at = $3 WHERE id = $1", [specimen.id, reason, clock.now()]);
    await audit.record(db, { entityType: 'specimen', entityId: specimen.id, action: 'REJECTED', from: specimen.status, to: 'REJECTED', actorId: user.id, details: { reason } });

    for (const item of items) {
      await setItemStatus(db, item, ITEM.COLLECTION_REQUIRED, user.id, { action: 'RECOLLECTION_REQUIRED', sets: { specimen_id: null }, details: { reason, rejectedSpecimenId: specimen.id } });
    }

    await notify(db, order.physician_id, {
      type: 'SPECIMEN_REJECTED',
      message: `Specimen ${specimen.accession_number} for order #${order.id} was rejected: ${reason}. Recollection required.`,
      entityType: 'order', entityId: order.id,
    });
    return { ...specimen, status: 'REJECTED', rejection_reason: reason };
  });
}

module.exports = { collectSpecimen, startProcessing, rejectSpecimen, nextAccessionNumber };
