import express from 'express';
import dotenv from 'dotenv';
import { sequelize } from '../models/index.js';
import zmusersRouter from './routes/zmusers.js';
import playerAuctionsRouter from './routes/playerAuctions.js';
import virtualGarageRouter from './routes/virtualGarage.js';
import logger from '../utils/logger.js';

dotenv.config();

const app = express();
app.use(express.json());

app.use('/zmusers', zmusersRouter);
app.use('/player-auctions', playerAuctionsRouter);
app.use('/virtual-garage', virtualGarageRouter);

const PORT = process.env.PORT || 3000;
const DB_TARGET = process.env.DB_TARGET || '(unset)';

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');
    logger.info('api/server database connected', { dbTarget: DB_TARGET });
    app.listen(PORT, () => console.log(`API server running on port ${PORT}`));
  } catch (err) {
    console.error('Unable to connect to database:', err);
    logger.error('api/server database connection failed', { dbTarget: DB_TARGET, error: err.message });
  }
}

start();
