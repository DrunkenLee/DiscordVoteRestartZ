import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create a new pool using the connection string from .env
const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Supabase connections
  }
});

// Test the connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to Supabase database:', err);
  } else {
    console.log('Successfully connected to Supabase database at:', res.rows[0].now);
  }
});

/**
 * Execute a query on the Supabase database
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} - Query result
 */
export async function query(text, params) {
  try {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a single row by ID
 * @param {string} table - Table name
 * @param {string|number} id - Row ID
 * @returns {Promise<Object>} - Row data
 */
export async function getById(table, id) {
  const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return result.rows[0];
}

/**
 * Insert a new row
 * @param {string} table - Table name
 * @param {Object} data - Data to insert
 * @returns {Promise<Object>} - Inserted row
 */
export async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columnNames = keys.join(', ');

  const result = await query(
    `INSERT INTO ${table} (${columnNames}) VALUES (${placeholders}) RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Update an existing row
 * @param {string} table - Table name
 * @param {string|number} id - Row ID
 * @param {Object} data - Data to update
 * @returns {Promise<Object>} - Updated row
 */
export async function update(table, id, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');

  const result = await query(
    `UPDATE ${table} SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );

  return result.rows[0];
}

/**
 * Delete a row
 * @param {string} table - Table name
 * @param {string|number} id - Row ID
 * @returns {Promise<boolean>} - Success status
 */
export async function remove(table, id) {
  const result = await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

// Close the pool when the app terminates
process.on('SIGINT', () => {
  pool.end();
  process.exit(0);
});

export default {
  query,
  getById,
  insert,
  update,
  remove,
  pool
};