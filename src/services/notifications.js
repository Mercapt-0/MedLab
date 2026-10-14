const clock = require('./clock');

/**
 * In-app notification delivery (simulated - no SMS/email gateway in the semester build).
 * The frontend polls /api/notifications every 10s, well inside the 30s target (NFR-02).
 */
async function notify(db, userIds, { type, message, entityType = null, entityId = null }) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  for (const userId of ids) {
    await db.query(
      `INSERT INTO notifications (user_id, type, message, entity_type, entity_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, type, message, entityType, entityId, clock.now()]
    );
  }
}

async function usersWithRole(db, role) {
  const { rows } = await db.query('SELECT id FROM users WHERE role = $1', [role]);
  return rows.map((r) => r.id);
}

module.exports = { notify, usersWithRole };
