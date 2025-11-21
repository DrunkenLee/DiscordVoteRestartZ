// Load environment variables
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  rcon: {
    host: process.env.RCON_HOST || "localhost",
    port: parseInt(process.env.RCON_PORT) || 27015,
    password: process.env.RCON_PASSWORD || ""
  },
  discord: {
    token: process.env.DISCORD_BOT_TOKEN || "",
    prefix: process.env.DISCORD_PREFIX || "!",
    aiChannelId: process.env.AI_CHANNEL_ID || "1403231225430413383",
    auctionChannelId: process.env.AUCTION_CHANNEL_ID || "1415589655587323914",
    vehicleRemovalChannelId: process.env.VEHICLE_REMOVAL_CHANNEL_ID || "1395072755208163398"
  },
  sftp: {
    host: process.env.SFTP_HOST || "",
    port: parseInt(process.env.SFTP_PORT) || 22,
    username: process.env.SFTP_USERNAME || "",
    password: process.env.SFTP_PASSWORD || ""
  },
  autoshop: {
    checkIntervalMinutes: parseInt(process.env.AUTOSHOP_CHECK_INTERVAL) || 1,
    remoteFilePath: process.env.AUTOSHOP_REMOTE_FILE_PATH || "/home/pzserver/Zomboid/Lua/ZM_Autoshop_VehicleRemoval.json"
  },
  battlemetrics: {
    apiKey: process.env.BATTLEMETRICS_API_KEY || "",
    serverId: process.env.BATTLEMETRICS_SERVER_ID || ""
  },
  logging: {
    level: process.env.LOG_LEVEL || "info"
  },
  ai: {
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "gpt-3.5-turbo",
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 150,
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7,
    enabled: process.env.AI_ENABLED === "true" || false
  },
  get(path) {
    const parts = path.split('.');
    let result = this;
    for (const part of parts) {
      result = result[part];
    }
    return result;
  }
};

export default config;