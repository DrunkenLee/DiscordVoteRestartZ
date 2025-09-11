import express from 'express';
import dotenv from 'dotenv';
import { sequelize } from '../models/index.js';
import zmusersRouter from './routes/zmusers.js';
import playerAuctionsRouter from './routes/playerAuctions.js';

dotenv.config();

const app = express();
app.use(express.json());

app.use('/zmusers', zmusersRouter);
app.use('/player-auctions', playerAuctionsRouter);

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');
    app.listen(PORT, () => console.log(`API server running on port ${PORT}`));
  } catch (err) {
    console.error('Unable to connect to database:', err);
  }
}

start();
