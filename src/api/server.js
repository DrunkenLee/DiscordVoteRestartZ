import express from 'express';
import dotenv from 'dotenv';
import { sequelize } from '../models/index.js';
import zmusersRouter from './routes/zmusers.js';
import playerAuctionsRouter from './routes/playerAuctions.js';
import virtualGarageRouter from './routes/virtualGarage.js';
import fleaMarketRouter from './routes/fleaMarket.js';
import adminClockSessionsRouter from './routes/adminClockSessions.js';
import serverLogsRouter from './routes/serverLogs.js';
import dashboardFeedRouter from './routes/dashboardFeed.js';
import logger from '../utils/logger.js';
import { apiRequestAuditLog } from './middleware/requestAuditLog.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(apiRequestAuditLog);

app.use('/zmusers', zmusersRouter);
app.use('/player-auctions', playerAuctionsRouter);
app.use('/virtual-garage', virtualGarageRouter);
app.use('/flea-market', fleaMarketRouter);
app.use('/admin-clock', adminClockSessionsRouter);
app.use('/server-logs', serverLogsRouter);
app.use('/dashboard', dashboardFeedRouter);

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
