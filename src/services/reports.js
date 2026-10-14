const { query } = require('../db/pool');

/**
 * Turnaround-time performance by test and priority (R-18).
 * TAT = first release time - order placed time. Target depends on priority.
 */
async function turnaround({ from, to } = {}) {
  const vals = [];
  const where = ["i.status = 'RELEASED'", 'i.released_at IS NOT NULL'];
  if (from) { vals.push(new Date(from)); where.push(`o.created_at >= $${vals.length}`); }
  if (to) {
    const d = new Date(to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setUTCDate(d.getUTCDate() + 1);
    vals.push(d); where.push(`o.created_at < $${vals.length}`);
  }
  const { rows } = await query(
    `WITH t AS (
       SELECT lt.code, lt.name, o.priority,
              EXTRACT(EPOCH FROM (i.released_at - o.created_at)) / 3600.0 AS actual_hours,
              CASE WHEN o.priority = 'stat' THEN lt.stat_tat_hours ELSE lt.tat_hours END AS target_hours
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         JOIN lab_tests lt ON lt.id = i.test_id
        WHERE ${where.join(' AND ')}
     )
     SELECT code, name, priority, COUNT(*)::int AS completed,
            ROUND(AVG(actual_hours)::numeric, 2) AS avg_hours,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY actual_hours))::numeric, 2) AS median_hours,
            ROUND(MAX(actual_hours)::numeric, 2) AS max_hours,
            MAX(target_hours) AS target_hours,
            ROUND(100.0 * AVG(CASE WHEN actual_hours <= target_hours THEN 1 ELSE 0 END), 1) AS pct_within_target
       FROM t
      GROUP BY code, name, priority
      ORDER BY code, priority`,
    vals
  );
  return rows;
}

module.exports = { turnaround };
