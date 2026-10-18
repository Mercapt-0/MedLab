// Recreate the test schema once per run.
module.exports = async () => {
  require('./env');
  const { migrate } = require('../../backend/src/db/migrate');
  const { pool } = require('../../backend/src/db/pool');
  await migrate({ reset: true });
  await pool.end();
};
