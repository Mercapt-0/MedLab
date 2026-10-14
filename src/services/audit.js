const clock = require('./clock');

/** Append one entry to the audit trail (R-19). Always call with the transaction client. */
async function record(db, { entityType, entityId, action, from = null, to = null, actorId = null, details = null }) {
  await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, from_state, to_state, actor_id, details, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entityType, entityId, action, from, to, actorId, details ? JSON.stringify(details) : null, clock.now()]
  );
}

module.exports = { record };
