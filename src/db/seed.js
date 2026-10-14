/**
 * Seed demo data.  `npm run seed`          -> users + catalogue + a few sample orders
 *                  `npm run seed -- --bulk` -> also 5,000 historical orders (NFR-02 perf check)
 * All demo accounts use password: Password123!
 */
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

const PASSWORD = 'Password123!';

const USERS = [
  { name: 'Alice Admin', email: 'admin@medlab.test', role: 'lab_admin' },
  { name: 'Dr. Diana Director', email: 'director@medlab.test', role: 'lab_admin', is_lab_director: true },
  { name: 'Dr. Paul Physician', email: 'physician@medlab.test', role: 'physician' },
  { name: 'Dr. Olivia Oncall', email: 'oncall@medlab.test', role: 'physician', is_on_call: true },
  { name: 'Tom Technician', email: 'tech@medlab.test', role: 'technician' },
  { name: 'Tina Tech', email: 'tech2@medlab.test', role: 'technician' },
  { name: 'Pat Patient', email: 'patient@medlab.test', role: 'patient', date_of_birth: '1990-04-12' },
  { name: 'Riya Shah', email: 'riya@medlab.test', role: 'patient', date_of_birth: '1985-11-02' },
  { name: 'Marcus Lee', email: 'marcus@medlab.test', role: 'patient', date_of_birth: '1972-06-30' },
];

// code, name, category, unit, refLow, refHigh, panicLow, panicHigh, panicOnPositive, tat, statTat
const TESTS = [
  ['GLU', 'Glucose', 'quantitative', 'mg/dL', 70, 99, 40, 500, false, 4, 1],
  ['NA', 'Sodium', 'quantitative', 'mmol/L', 135, 145, 120, 160, false, 4, 1],
  ['K', 'Potassium', 'quantitative', 'mmol/L', 3.5, 5.1, 2.5, 6.5, false, 4, 1],
  ['CL', 'Chloride', 'quantitative', 'mmol/L', 98, 107, 80, 120, false, 4, 1],
  ['CO2', 'Carbon Dioxide', 'quantitative', 'mmol/L', 22, 29, 10, 40, false, 4, 1],
  ['BUN', 'Blood Urea Nitrogen', 'quantitative', 'mg/dL', 7, 20, null, 100, false, 4, 1],
  ['CREAT', 'Creatinine', 'quantitative', 'mg/dL', 0.6, 1.3, null, 7, false, 4, 1],
  ['CA', 'Calcium', 'quantitative', 'mg/dL', 8.6, 10.3, 6, 13, false, 4, 1],
  ['HGB', 'Hemoglobin', 'quantitative', 'g/dL', 12, 17.5, 7, 20, false, 2, 1],
  ['WBC', 'White Blood Cell Count', 'quantitative', 'x10^3/uL', 4.5, 11, 2, 30, false, 2, 1],
  ['PLT', 'Platelet Count', 'quantitative', 'x10^3/uL', 150, 450, 50, 1000, false, 2, 1],
  ['TROP', 'Troponin I', 'quantitative', 'ng/mL', 0, 0.04, null, 0.5, false, 2, 1],
  ['HCG', 'hCG, Qualitative (Urine)', 'qualitative', null, null, null, null, null, false, 2, 1],
  ['COVID', 'SARS-CoV-2 PCR', 'qualitative', null, null, null, null, null, false, 24, 4],
  ['BCX', 'Blood Culture', 'culture', null, null, null, null, null, true, 72, 48],
  ['UCX', 'Urine Culture', 'culture', null, null, null, null, null, false, 48, 24],
];

const PANELS = [
  ['BMP', 'Basic Metabolic Panel', ['GLU', 'NA', 'K', 'CL', 'CO2', 'BUN', 'CREAT', 'CA']],
  ['CBC', 'Complete Blood Count', ['HGB', 'WBC', 'PLT']],
];

async function seed({ bulk = false, client } = {}) {
  const db = client || pool;
  const hash = await bcrypt.hash(PASSWORD, 10);
  const userIds = {};
  for (const u of USERS) {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, role, date_of_birth, is_on_call, is_lab_director)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [u.name, u.email, hash, u.role, u.date_of_birth || null, !!u.is_on_call, !!u.is_lab_director]
    );
    userIds[u.email] = rows[0].id;
  }

  const testIds = {};
  for (const t of TESTS) {
    const { rows } = await db.query(
      `INSERT INTO lab_tests (code, name, category, unit, ref_low, ref_high, panic_low, panic_high, panic_on_positive, tat_hours, stat_tat_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      t
    );
    testIds[t[0]] = rows[0].id;
  }

  for (const [code, name, comps] of PANELS) {
    const { rows } = await db.query(
      'INSERT INTO panels (code, name) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id',
      [code, name]
    );
    for (const c of comps) {
      await db.query('INSERT INTO panel_tests (panel_id, test_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, testIds[c]]);
    }
  }

  if (bulk) await seedBulk(db, userIds, testIds);
  return { userIds, testIds };
}

/** 5,000 closed historical orders spread over the past year, for search performance and TAT reports. */
async function seedBulk(db, userIds, testIds) {
  const patients = ['patient@medlab.test', 'riya@medlab.test', 'marcus@medlab.test'].map((e) => userIds[e]);
  const physicians = ['physician@medlab.test', 'oncall@medlab.test'].map((e) => userIds[e]);
  const techs = ['tech@medlab.test', 'tech2@medlab.test'].map((e) => userIds[e]);
  const codes = ['GLU', 'K', 'NA', 'HGB', 'WBC', 'TROP', 'CREAT'];
  await db.query(
    `WITH o AS (
       INSERT INTO orders (patient_id, physician_id, priority, status, assigned_technician_id, created_at, closed_at)
       SELECT ($1::int[])[1 + (g % 3)], ($2::int[])[1 + (g % 2)],
              CASE WHEN g % 7 = 0 THEN 'stat' ELSE 'routine' END, 'CLOSED',
              ($3::int[])[1 + (g % 2)],
              now() - (g || ' hours')::interval * 1.7,
              now() - (g || ' hours')::interval * 1.7 + interval '3 hours'
         FROM generate_series(1, 5000) g
       RETURNING id, created_at, priority
     )
     INSERT INTO order_items (order_id, test_id, status, released_at)
     SELECT o.id, ($4::int[])[1 + (o.id % $5)], 'RELEASED',
            o.created_at + ((CASE WHEN o.priority = 'stat' THEN 0.5 ELSE 2 END) + (o.id % 5) * 0.6) * interval '1 hour'
       FROM o`,
    [patients, physicians, techs, codes.map((c) => testIds[c]), codes.length]
  );
  console.log('Bulk: inserted 5,000 historical orders');
}

module.exports = { seed, PASSWORD, USERS };

if (require.main === module) {
  seed({ bulk: process.argv.includes('--bulk') })
    .then(() => {
      console.log('Seed complete. Demo logins (password "Password123!"):');
      for (const u of USERS) console.log(`  ${u.role.padEnd(11)} ${u.email}`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
