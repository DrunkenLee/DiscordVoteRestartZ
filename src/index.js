import { DiscordBot } from './discord/bot.js';
import { RconClient } from './rcon/client.js';
import config from './config/config.js';
import express from 'express';
import cors from 'cors';
import { sequelize } from './models/index.js';
import zmusersRouter from './api/routes/zmusers.js';
import playerAuctionsRouter from './api/routes/playerAuctions.js';
import virtualGarageRouter from './api/routes/virtualGarage.js';
import fleaMarketRouter from './api/routes/fleaMarket.js';
import authRouter from './api/routes/auth.js';
import mapRouter from './api/routes/map.js';
import userDetailsRouter from './api/routes/userDetails.js';
import adminClockSessionsRouter from './api/routes/adminClockSessions.js';
import raidPointsRouter from './api/routes/raidPoints.js';
import serverLogsRouter from './api/routes/serverLogs.js';
import path from 'path';
import { AuctionLogMonitor } from './services/auctionLogMonitor.js';
import { NodeApiQueueProcessor } from './services/nodeApiQueueProcessor.js';
import logger from './utils/logger.js';
import { apiRequestAuditLog } from './api/middleware/requestAuditLog.js';

async function main() {
  const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://zonamerahwebsite.web.app',
    'https://*.zonamerahwebsite.web.app',
    'https://zonamerahwebsite.firebaseapp.com',
    'https://*.zonamerahwebsite.firebaseapp.com',
    'https://zonamerah.pro',
    'https://www.zonamerah.pro',
    'https://dev.zonamerah.pro',
    'https://*.zonamerah.pro',
  ];
  const configuredAllowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredAllowedOrigins]);
  const allowAnyOrigin = allowedOrigins.has('*');
  const wildcardOrigins = [...allowedOrigins].filter((origin) => origin.includes('*'));

  const isOriginAllowed = (origin) => {
    if (!origin) return true; // non-browser requests may not send Origin
    if (allowAnyOrigin || allowedOrigins.has(origin)) return true;

    for (const wildcardOrigin of wildcardOrigins) {
      const match = wildcardOrigin.match(/^(https?:\/\/)\*\.(.+)$/i);
      if (!match) continue;

      const [, protocol, domain] = match;
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === protocol && parsed.hostname.endsWith(`.${domain}`)) {
          return true;
        }
      } catch {
        return false;
      }
    }

    return false;
  };

  const corsOptionsDelegate = (req, callback) => {
    const requestOrigin = req.get('Origin') || '';
    const originAllowed = isOriginAllowed(requestOrigin);
    if (requestOrigin && !originAllowed) {
      logger.warn('cors blocked origin', {
        origin: requestOrigin,
        method: req.method,
        path: req.originalUrl || req.url,
      });
    }

    callback(null, {
      origin: originAllowed && requestOrigin ? requestOrigin : false,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Origin', 'X-Requested-With'],
      exposedHeaders: ['Content-Length', 'Content-Type'],
      maxAge: 86400,
      optionsSuccessStatus: 204,
    });
  };

  // Initialize Express API server
  const app = express();
  app.locals.discordClient = null;
  app.use((req, res, next) => {
    res.header('Vary', 'Origin');
    next();
  });
  app.use(cors(corsOptionsDelegate));
  app.options('*', cors(corsOptionsDelegate));
  app.use(express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use(apiRequestAuditLog);

  // API routes (prefixed with /api)
  app.use('/api/zmusers', zmusersRouter);
  app.use('/api/player-auctions', playerAuctionsRouter);
  app.use('/api/virtual-garage', virtualGarageRouter);
  app.use('/api/flea-market', fleaMarketRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/map', mapRouter);
  app.use('/api/user-details', userDetailsRouter);
  app.use('/api/admin-clock', adminClockSessionsRouter);
  app.use('/api/raid-points', raidPointsRouter);
  app.use('/api/server-logs', serverLogsRouter);

  // Legacy (non-prefixed) routes for backward compatibility
  app.use('/zmusers', zmusersRouter);
  app.use('/player-auctions', playerAuctionsRouter);
  app.use('/virtual-garage', virtualGarageRouter);
  app.use('/flea-market', fleaMarketRouter);
  app.use('/auth', authRouter);
  app.use('/map', mapRouter);
  app.use('/user-details', userDetailsRouter);
  app.use('/admin-clock', adminClockSessionsRouter);
  app.use('/raid-points', raidPointsRouter);
  app.use('/server-logs', serverLogsRouter);

  // Serve static map assets (if present)
  const pzmapStatic = path.resolve(process.cwd(), 'public', 'pzmap');
  app.use('/pzmap', express.static(pzmapStatic));
  const uploadsStatic = path.resolve(process.cwd(), 'public', 'uploads');
  app.use('/uploads', express.static(uploadsStatic));

  const PORT = process.env.PORT || 3000;
  const API_ONLY = process.env.API_ONLY === 'true';
  const DB_TARGET = process.env.DB_TARGET || '(unset)';
  const auctionLogMonitorEnv = String(process.env.AUCTION_LOG_MONITOR_ENABLED ?? 'true').trim().toLowerCase();
  const AUCTION_LOG_MONITOR_ENABLED = !['0', 'false', 'no', 'off'].includes(auctionLogMonitorEnv);

  const discordBot = new DiscordBot(config.discord.token);
  let rconClient = new RconClient(config.rcon.host, config.rcon.port, config.rcon.password);
  const nodeApiQueueProcessor = new NodeApiQueueProcessor();

  // Pass Discord client to auction monitor for notifications
  const auctionLogMonitor = AUCTION_LOG_MONITOR_ENABLED ? new AuctionLogMonitor(discordBot.client) : null;

  try {
    // Start API server first to allow API_ONLY mode quickly
    app.listen(PORT, () => {
      console.log(`API server running on port ${PORT}`);
      logger.info('api server listening', { port: Number(PORT), apiOnly: API_ONLY, dbTarget: DB_TARGET });
    });
    nodeApiQueueProcessor.start();

    if (API_ONLY) {
      console.log('API_ONLY mode enabled. Skipping database, Discord bot, RCON, and auction monitor.');
      return;
    }

    // Then, connect to database
    console.log('Connecting to database...');
    try {
      await sequelize.authenticate();
      console.log('Database connected successfully.');
      logger.info('database connected', { dbTarget: DB_TARGET });
    } catch (dbError) {
      console.error('Database connection failed:', dbError.message);
      console.log('Bot will continue without database. Some features may be limited.');
      logger.error('database connection failed', { dbTarget: DB_TARGET, error: dbError.message });
    }

    // continue with Discord/RCON init when not API_ONLY

    // Then, log in to Discord
    console.log('Logging in to Discord...');
    await discordBot.login();
    console.log('Discord bot logged in successfully.');
    app.locals.discordClient = discordBot.client;

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
    if (auctionLogMonitor) {
      console.log('Starting auction log monitoring...');
      try {
        await auctionLogMonitor.start();
        console.log('Auction log monitoring started successfully.');
      } catch (monitorError) {
        console.error('Auction monitor failed to start:', monitorError.message);
        console.log('Bot will continue without auction monitoring.');
      }
    } else {
      console.log('Auction log monitoring disabled by AUCTION_LOG_MONITOR_ENABLED=false.');
      logger.info('auction log monitoring disabled by env');
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');

      // Stop auction monitoring
      if (auctionLogMonitor) {
        auctionLogMonitor.stop();
      }
      nodeApiQueueProcessor.stop();

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
