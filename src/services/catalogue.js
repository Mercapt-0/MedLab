const { query, withTransaction } = require('../db/pool');
const { badRequest, notFound } = require('../errors');
const audit = require('./audit');

const CATEGORIES = ['quantitative', 'qualitative', 'culture'];
const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function validateTest(b, partial = false) {
  if (!partial || b.code !== undefined) if (!b.code || !String(b.code).trim()) throw badRequest('code is required');
  if (!partial || b.name !== undefined) if (!b.name || !String(b.name).trim()) throw badRequest('name is required');
  if (!partial || b.category !== undefined) if (!CATEGORIES.includes(b.category)) throw badRequest(`category must be one of ${CATEGORIES.join(', ')}`);
  for (const k of ['refLow', 'refHigh', 'panicLow', 'panicHigh', 'tatHours', 'statTatHours']) {
    if (b[k] !== undefined && b[k] !== null && b[k] !== '' && !Number.isFinite(Number(b[k]))) throw badRequest(`${k} must be a number`);
  }
  if (n(b.refLow) !== null && n(b.refHigh) !== null && n(b.refLow) > n(b.refHigh)) throw badRequest('refLow must be <= refHigh');
  if (b.tatHours !== undefined && n(b.tatHours) !== null && n(b.tatHours) <= 0) throw badRequest('tatHours must be positive');
}

async function listTests({ includeInactive } = {}) {
  return (await query(`SELECT * FROM lab_tests ${includeInactive ? '' : 'WHERE active'} ORDER BY code`)).rows;
}

async function createTest(user, b) {
  validateTest(b);
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO lab_tests (code, name, category, unit, ref_low, ref_high, panic_low, panic_high, panic_on_positive, tat_hours, stat_tat_hours)
       VALUES (upper($1),$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,24),COALESCE($11,2)) RETURNING *`,
      [b.code, b.name, b.category, b.unit || null, n(b.refLow), n(b.refHigh), n(b.panicLow), n(b.panicHigh), !!b.panicOnPositive, n(b.tatHours), n(b.statTatHours)]
    );
    await audit.record(db, { entityType: 'lab_test', entityId: rows[0].id, action: 'CATALOGUE_TEST_CREATED', actorId: user.id, details: b });
    return rows[0];
  });
}

async function updateTest(user, id, b) {
  validateTest(b, true);
  const map = {
    name: 'name', unit: 'unit', refLow: 'ref_low', refHigh: 'ref_high', panicLow: 'panic_low', panicHigh: 'panic_high',
    panicOnPositive: 'panic_on_positive', tatHours: 'tat_hours', statTatHours: 'stat_tat_hours', active: 'active',
  };
  const sets = [];
  const vals = [id];
  for (const [k, col] of Object.entries(map)) {
    if (b[k] === undefined) continue;
    vals.push(['ref_low', 'ref_high', 'panic_low', 'panic_high', 'tat_hours', 'stat_tat_hours'].includes(col) ? n(b[k]) : b[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) throw badRequest('Nothing to update');
  return withTransaction(async (db) => {
    const { rows } = await db.query(`UPDATE lab_tests SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    if (!rows[0]) throw notFound('Test');
    await audit.record(db, { entityType: 'lab_test', entityId: id, action: 'CATALOGUE_TEST_UPDATED', actorId: user.id, details: b });
    return rows[0];
  });
}

async function listPanels() {
  const { rows } = await query(
    `SELECT p.*, COALESCE(json_agg(json_build_object('id', t.id, 'code', t.code, 'name', t.name) ORDER BY t.code)
                          FILTER (WHERE t.id IS NOT NULL), '[]') AS tests
       FROM panels p
       LEFT JOIN panel_tests pt ON pt.panel_id = p.id
       LEFT JOIN lab_tests t ON t.id = pt.test_id
      WHERE p.active
      GROUP BY p.id ORDER BY p.code`
  );
  return rows;
}

async function setPanelTests(db, panelId, testIds) {
  const ids = [...new Set((testIds || []).map(Number))];
  if (ids.length < 2) throw badRequest('A panel needs at least two component tests');
  const found = await db.query('SELECT id FROM lab_tests WHERE id = ANY($1) AND active', [ids]);
  if (found.rowCount !== ids.length) throw badRequest('One or more tests are unknown or inactive');
  await db.query('DELETE FROM panel_tests WHERE panel_id = $1', [panelId]);
  for (const t of ids) await db.query('INSERT INTO panel_tests (panel_id, test_id) VALUES ($1,$2)', [panelId, t]);
}

async function createPanel(user, { code, name, testIds }) {
  if (!code || !name) throw badRequest('code and name are required');
  return withTransaction(async (db) => {
    const { rows } = await db.query('INSERT INTO panels (code, name) VALUES (upper($1), $2) RETURNING *', [code, name]);
    await setPanelTests(db, rows[0].id, testIds);
    await audit.record(db, { entityType: 'panel', entityId: rows[0].id, action: 'PANEL_CREATED', actorId: user.id, details: { testIds } });
    return rows[0];
  });
}

async function updatePanel(user, id, { name, testIds, active }) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      'UPDATE panels SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1 RETURNING *',
      [id, name ?? null, active ?? null]
    );
    if (!rows[0]) throw notFound('Panel');
    if (testIds) await setPanelTests(db, id, testIds);
    await audit.record(db, { entityType: 'panel', entityId: id, action: 'PANEL_UPDATED', actorId: user.id, details: { name, testIds, active } });
    return rows[0];
  });
}

module.exports = { listTests, createTest, updateTest, listPanels, createPanel, updatePanel };
