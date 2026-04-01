import { DiscordBot } from './discord/bot.js';
import { RconClient } from './rcon/client.js';
import config from './config/config.js';
import express from 'express';
import cors from 'cors';
import { sequelize } from './models/index.js';
import zmusersRouter from './api/routes/zmusers.js';
import playerAuctionsRouter from './api/routes/playerAuctions.js';
import virtualGarageRouter from './api/routes/virtualGarage.js';
import authRouter from './api/routes/auth.js';
import mapRouter from './api/routes/map.js';
import path from 'path';
import { AuctionLogMonitor } from './services/auctionLogMonitor.js';

async function main() {
  // Initialize Express API server
  const app = express();
  app.use(cors());
  app.use(express.json());

  // API routes (prefixed with /api)
  app.use('/api/zmusers', zmusersRouter);
  app.use('/api/player-auctions', playerAuctionsRouter);
  app.use('/api/virtual-garage', virtualGarageRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/map', mapRouter);

  // Legacy (non-prefixed) routes for backward compatibility
  app.use('/zmusers', zmusersRouter);
  app.use('/player-auctions', playerAuctionsRouter);
  app.use('/virtual-garage', virtualGarageRouter);
  app.use('/auth', authRouter);
  app.use('/map', mapRouter);

  // Serve static map assets (if present)
  const pzmapStatic = path.resolve(process.cwd(), 'public', 'pzmap');
  app.use('/pzmap', express.static(pzmapStatic));

  const PORT = process.env.PORT || 3000;
  const API_ONLY = process.env.API_ONLY === 'true';

  const discordBot = new DiscordBot(config.discord.token);
  let rconClient = new RconClient(config.rcon.host, config.rcon.port, config.rcon.password);

  // Pass Discord client to auction monitor for notifications
  const auctionLogMonitor = new AuctionLogMonitor(discordBot.client);

  try {
    // Start API server first to allow API_ONLY mode quickly
    app.listen(PORT, () => {
      console.log(`API server running on port ${PORT}`);
    });

    if (API_ONLY) {
      console.log('API_ONLY mode enabled. Skipping database, Discord bot, RCON, and auction monitor.');
      return;
    }

    // Then, connect to database
    console.log('Connecting to database...');
    try {
      await sequelize.authenticate();
      console.log('Database connected successfully.');
    } catch (dbError) {
      console.error('Database connection failed:', dbError.message);
      console.log('Bot will continue without database. Some features may be limited.');
    }

    // continue with Discord/RCON init when not API_ONLY

    // Then, log in to Discord
    console.log('Logging in to Discord...');
    await discordBot.login();
    console.log('Discord bot logged in successfully.');

    // Set up initial RCON connection (non-blocking)
    console.log('Connecting to RCON server...');
    try {
      await rconClient.connect();
      console.log('Connected to RCON server.');
    } catch (rconError) {
      console.error('RCON connection failed:', rconError.message);
      console.log('Bot will continue without RCON. Auto-reconnect will attempt to connect later.');
    }

    // Setup event listeners with the wrapped RCON client and auction monitor
    // This must happen even if RCON fails, so Discord commands still work
    discordBot.setupEventListeners(rconClient, auctionLogMonitor);

    // Start auction log monitoring (non-blocking)
    console.log('Starting auction log monitoring...');
    try {
      await auctionLogMonitor.start();
      console.log('Auction log monitoring started successfully.');
    } catch (monitorError) {
      console.error('Auction monitor failed to start:', monitorError.message);
      console.log('Bot will continue without auction monitoring.');
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');

      // Stop auction monitoring
      auctionLogMonitor.stop();

      discordBot.cleanup();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

  } catch (error) {
    console.error('Error during initialization:', error);

    // If database connection fails, log but continue
    if (error.name === 'SequelizeConnectionError') {
      console.error('Database connection failed, but continuing with Discord bot...');
    }

    // If Discord connection fails, we should exit
    if (!API_ONLY && !discordBot.client.isReady()) {
      console.error('Discord connection failed. Exiting...');
      process.exit(1);
    }

    // If only RCON fails, we can continue and let the auto-reconnect handle it
    if (error.message.includes('RCON')) {
      console.log('Will attempt to reconnect to RCON server automatically...');
      // The heartbeat mechanism in the DiscordBot class will handle reconnection
    }
  }
}

main();
