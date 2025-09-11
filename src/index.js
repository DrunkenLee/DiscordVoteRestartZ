import { DiscordBot } from './discord/bot.js';
import { RconClient } from './rcon/client.js';
import config from './config/config.js';
import express from 'express';
import { sequelize } from './models/index.js';
import zmusersRouter from './api/routes/zmusers.js';
import playerAuctionsRouter from './api/routes/playerAuctions.js';
import { AuctionLogMonitor } from './services/auctionLogMonitor.js';

async function main() {
  // Initialize Express API server
  const app = express();
  app.use(express.json());

  // API routes
  app.use('/zmusers', zmusersRouter);
  app.use('/player-auctions', playerAuctionsRouter);

  const PORT = process.env.PORT || 3000;

  const discordBot = new DiscordBot(config.discord.token);
  let rconClient = new RconClient(config.rcon.host, config.rcon.port, config.rcon.password);

  // Pass Discord client to auction monitor for notifications
  const auctionLogMonitor = new AuctionLogMonitor(discordBot.client);

  try {
    // First, connect to database
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Database connected successfully.');

    // Start API server
    app.listen(PORT, () => {
      console.log(`API server running on port ${PORT}`);
    });

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
    if (!discordBot.client.isReady()) {
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