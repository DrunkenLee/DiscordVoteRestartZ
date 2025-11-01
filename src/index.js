import { DiscordBot } from './discord/bot.js';
import { RconClient } from './rcon/client.js';
import config from './config/config.js';
import express from 'express';
import cors from 'cors';
import { sequelize } from './models/index.js';
import zmusersRouter from './api/routes/zmusers.js';
import playerAuctionsRouter from './api/routes/playerAuctions.js';
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
  app.use('/api/auth', authRouter);
  app.use('/api/map', mapRouter);

  // Legacy (non-prefixed) routes for backward compatibility
  app.use('/zmusers', zmusersRouter);
  app.use('/player-auctions', playerAuctionsRouter);
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
    await sequelize.authenticate();
    console.log('Database connected successfully.');

    // continue with Discord/RCON init when not API_ONLY

    // Then, log in to Discord
    console.log('Logging in to Discord...');
    await discordBot.login();
    console.log('Discord bot logged in successfully.');

    // Set up initial RCON connection
    console.log('Connecting to RCON server...');
    await rconClient.connect();
    console.log('Connected to RCON server.');

    // Setup event listeners with the wrapped RCON client and auction monitor
    discordBot.setupEventListeners(rconClient, auctionLogMonitor);

    // Start auction log monitoring
    console.log('Starting auction log monitoring...');
    await auctionLogMonitor.start();
    console.log('Auction log monitoring started successfully.');

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