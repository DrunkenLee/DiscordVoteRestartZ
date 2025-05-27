import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Use the connection string from your .env
const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(res => {
    console.log('Successfully connected to Supabase database:', res.rows[0].now);
  })
  .catch(err => {
    console.error('Error connecting to Supabase database:', err);
  });

// Example: Find user by Discord ID
export async function findUserByDiscordId(discordId) {
  const result = await pool.query(
    'SELECT * FROM public.zmusers WHERE discordid = $1',
    [discordId]
  );
  return result.rows[0] || null;
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

// Export the pool for advanced queries if needed
export { pool };