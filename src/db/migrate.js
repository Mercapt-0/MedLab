const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate({ reset = false } = {}) {
  if (reset) {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { migrate };

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  migrate({ reset })
    .then(() => {
      console.log(reset ? 'Database reset and migrated.' : 'Database migrated.');
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
