const { Pool } = require('pg');
const config = require('../config');

// pg returns NUMERIC as string by default; parse to JS number for this app's ranges.
require('pg').types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const pool = new Pool({ connectionString: config.databaseUrl });

/**
 * Run fn(client) inside a transaction. Rolls back on any thrown error, so a
 * request interrupted mid-transition never leaves partial state (NFR-04).
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (text, params) => pool.query(text, params), withTransaction };
