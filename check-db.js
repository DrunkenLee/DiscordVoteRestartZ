import { sequelize } from './src/models/index.js';

async function checkTables() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');

    // Check zmusers table structure
    const [results] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'zmusers'
      ORDER BY ordinal_position;
    `);

    console.log('\nzmusers table structure:');
    console.table(results);

    // Check player_auctions table structure
    const [results2] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'player_auctions'
      ORDER BY ordinal_position;
    `);

    console.log('\nplayer_auctions table structure:');
    console.table(results2);

    // Check if tables exist
    const [tables] = await sequelize.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE';
    `);

    console.log('\nAll tables in database:');
    console.table(tables);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sequelize.close();
  }
}

checkTables();
