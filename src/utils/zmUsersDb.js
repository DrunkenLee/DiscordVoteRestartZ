import { Pool } from 'pg';
import dotenv from 'dotenv';
import sequelizeHelper from '../../config/sequelize-helper.cjs';

dotenv.config();

const connectionString = sequelizeHelper.resolveDatabaseUrl();
if (!connectionString) {
  throw new Error('Missing database URL. Set DATABASE_URL_REMOTE, DATABASE_URL_PROD, or DATABASE_URL.');
}

const poolConfig = { connectionString };
if (sequelizeHelper.shouldUseSsl()) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Test connection on startup
pool.query('SELECT NOW()')
  .then(res => {
    console.log('Successfully connected to PostgreSQL database:', res.rows[0].now);
  })
  .catch(err => {
    console.error('Error connecting to PostgreSQL database:', err);
  });

// Example: Find user by Discord ID
export async function findUserByDiscordId(discordId) {
  const result = await pool.query(
    'SELECT * FROM public.zmusers WHERE discordid = $1',
    [discordId]
  );
  return result.rows[0] || null;
}

// Return all user rows associated with a Discord ID
export async function findUsersByDiscordId(discordId) {
  const result = await pool.query(
    'SELECT * FROM public.zmusers WHERE discordid = $1',
    [discordId]
  );
  return result.rows || [];
}

// Example: Add user
export async function addUser(userData) {
  const { discordid, steamid, ownerid, username1, password1, username2, password2, extradata } = userData;
  const result = await pool.query(
    `INSERT INTO public.zmusers
     (discordid, steamid, ownerid, username1, password1, username2, password2, extradata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [discordid, steamid, ownerid, username1, password1, username2, password2, extradata]
  );
  return result.rows[0];
}

// zmUsersDb.js
export async function updateUserPasswordByDiscordId(discordid, newPassword) {
  const result = await pool.query(
    'UPDATE public.zmusers SET password1 = $1 WHERE discordid = $2 RETURNING *',
    [newPassword, discordid]
  );
  return result.rows[0];
}

// Export the pool for advanced queries if needed
export { pool };