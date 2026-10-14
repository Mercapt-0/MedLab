const PDFDocument = require('pdfkit');
const { query } = require('../db/pool');
const { forbidden, notFound, conflict } = require('../errors');
const { resultTypeFor } = require('../domain/resultTypes');
const { decorateVersions } = require('./results');

function assertCanSeePatient(user, patientId) {
  if (user.role === 'patient' && user.id !== Number(patientId)) throw forbidden('Patients can only view their own records');
  if (user.role === 'technician') throw forbidden();
}

/**
 * Complete chronological test history for a patient (R-16), including superseded
 * (amended) versions. Patients only ever see released versions.
 */
async function history(user, patientId) {
  assertCanSeePatient(user, patientId);
  const patient = (await query("SELECT id, name, date_of_birth FROM users WHERE id = $1 AND role = 'patient'", [patientId])).rows[0];
  if (!patient) throw notFound('Patient');

  const { rows } = await query(
    `SELECT i.id AS item_id, i.status, i.released_at AS first_released_at, o.id AS order_id, o.priority, o.created_at AS ordered_at,
            d.name AS physician_name, lt.code AS test_code, lt.name AS test_name, lt.category, lt.unit, lt.ref_low, lt.ref_high,
            v.id AS version_id, v.version, v.data, v.abnormal_flag, v.is_panic, v.is_amendment, v.amendment_reason,
            v.entered_at, v.released_at
       FROM orders o
       JOIN order_items i ON i.order_id = o.id
       JOIN lab_tests lt ON lt.id = i.test_id
       JOIN users d ON d.id = o.physician_id
       LEFT JOIN result_versions v ON v.order_item_id = i.id ${user.role === 'patient' ? 'AND v.released_at IS NOT NULL' : ''}
      WHERE o.patient_id = $1 ${user.role === 'patient' ? "AND i.status = 'RELEASED'" : ''}
      ORDER BY o.created_at, i.id, v.version`,
    [patientId]
  );

  // group versions under each test
  const byItem = new Map();
  for (const r of rows) {
    if (!byItem.has(r.item_id)) {
      byItem.set(r.item_id, {
        itemId: r.item_id, orderId: r.order_id, orderedAt: r.ordered_at, priority: r.priority, status: r.status,
        physicianName: r.physician_name, testCode: r.test_code, testName: r.test_name, category: r.category,
        unit: r.unit, refLow: r.ref_low, refHigh: r.ref_high, versions: [],
      });
    }
    if (r.version_id) {
      byItem.get(r.item_id).versions.push({
        id: r.version_id, version: r.version, data: r.data, abnormal_flag: r.abnormal_flag, is_panic: r.is_panic,
        is_amendment: r.is_amendment, amendment_reason: r.amendment_reason, entered_at: r.entered_at, released_at: r.released_at,
      });
    }
  }
  const tests = [...byItem.values()].map((t) => {
    const versions = decorateVersions(t.versions);
    const type = resultTypeFor({ category: t.category, unit: t.unit, ref_low: t.refLow, ref_high: t.refHigh });
    return { ...t, versions: versions.map((v) => ({ ...v, summary: type.summarize(v.data) })) };
  });
  return { patient, tests };
}

/** Stream a PDF report for one released test (R-15). */
async function streamReport(user, itemId, res) {
  const { rows } = await query(
    `SELECT i.*, o.patient_id, o.physician_id, o.priority, o.created_at AS ordered_at,
            p.name AS patient_name, p.date_of_birth, d.name AS physician_name,
            lt.code, lt.name AS test_name, lt.category, lt.unit, lt.ref_low, lt.ref_high, s.accession_number
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN users p ON p.id = o.patient_id
       JOIN users d ON d.id = o.physician_id
       JOIN lab_tests lt ON lt.id = i.test_id
       LEFT JOIN specimens s ON s.id = i.specimen_id
      WHERE i.id = $1`,
    [itemId]
  );
  const it = rows[0];
  if (!it) throw notFound('Test');
  if (user.role === 'patient' && it.patient_id !== user.id) throw forbidden();
  if (user.role === 'physician' && it.physician_id !== user.id) throw forbidden();
  if (user.role === 'technician') throw forbidden();
  if (it.status !== 'RELEASED') throw conflict('A report is only available once the result is released');

  const versions = decorateVersions(
    (await query('SELECT * FROM result_versions WHERE order_item_id = $1 AND released_at IS NOT NULL ORDER BY version', [itemId])).rows
  );
  const type = resultTypeFor(it);
  const current = versions.find((v) => v.state === 'CURRENT');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="MedLab-${it.code}-${it.id}.pdf"`);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(20).text('MedLab - Laboratory Report', { align: 'left' });
  doc.moveDown(0.3).fontSize(9).fillColor('#666').text('Simulated data - CSE 5324 course project. Not for clinical use.');
  doc.moveDown().fillColor('#000').fontSize(11);
  doc.text(`Patient: ${it.patient_name}${it.date_of_birth ? `   DOB: ${new Date(it.date_of_birth).toISOString().slice(0, 10)}` : ''}`);
  doc.text(`Ordering physician: ${it.physician_name}`);
  doc.text(`Order #${it.order_id}   Priority: ${it.priority.toUpperCase()}   Ordered: ${new Date(it.ordered_at).toLocaleString()}`);
  doc.text(`Accession: ${it.accession_number || '-'}`);
  doc.moveDown();
  doc.fontSize(14).text(`${it.test_name} (${it.code})`);
  doc.fontSize(12).text(`Result: ${type.summarize(current.data)}${current.abnormal_flag ? `   [${current.abnormal_flag}]` : ''}`);
  if (current.data.comment) doc.fontSize(10).text(`Comment: ${current.data.comment}`);
  doc.fontSize(10).text(`Released: ${new Date(current.released_at).toLocaleString()}   Version ${current.version}${current.is_amendment ? ' (AMENDED)' : ''}`);
  if (versions.length > 1) {
    doc.moveDown().fontSize(12).text('Version history');
    for (const v of versions) {
      doc.fontSize(9).text(
        `v${v.version}  ${v.state}  ${new Date(v.released_at).toLocaleString()}  ${type.summarize(v.data)}${v.amendment_reason ? `  - reason: ${v.amendment_reason}` : ''}`
      );
    }
  }
  doc.end();
}

module.exports = { history, streamReport };
