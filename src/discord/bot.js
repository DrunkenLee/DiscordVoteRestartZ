import { Client, GatewayIntentBits, Events, ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BattleMetricsAPI } from '../utils/battlemetrics.js';
import { PlayerAuction } from '../models/playerAuction.js';
import { ZMUser } from '../models/zmuser.js';
import { Op } from 'sequelize';
import config from '../config/config.js';
import { commands } from './commands.js';
import { SftpLogReader } from '../utils/sftpLogReader.js';
import { Client as SSHClient } from 'ssh2';
import dotenv from 'dotenv';
import * as zmUsersDb from '../utils/zmUsersDb.js';
import cron from 'node-cron';
dotenv.config();
// import RPC from 'discord-rpc'; // Not needed for bot applications
import { BotLuaCommandManager } from './bot_luacmd.js';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
// Toggle for verbose getUserPoints debug logging
const ENABLE_POINTS_DEBUG = false;

export class DiscordBot {
  constructor(token) {
    this.token = token || config.discord.token;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });

    this.battlemetrics = new BattleMetricsAPI(config.battlemetrics.apiKey, config.battlemetrics.serverId);
    this.sftpLogReader = new SftpLogReader();

    // Track the last restart time for cooldown
    this.lastRestartTime = null;
    // Required number of confirmations
    this.requiredConfirmations = 5;
    // Cooldown period in milliseconds (1 hour)
    this.restartCooldown = 60 * 60 * 1000;

    // RCON connection management
    this.rconClient = null;
    this.rconHeartbeatInterval = null;
    this.heartbeatIntervalTime = 2 * 60 * 1000; // 2 minutes (reduced from 5 to keep connection alive)
    this.isReconnecting = false;

    // Add this for cooldown tracking
    this.commandCooldowns = new Map();
    this.cooldownTime = 2 * 60 * 1000; // 2 minutes in ms

    // Add development mode flag
    this.devMode = false; // Default to false (all commands available)

    // Store RCON client reference for cron jobs
    this.wrappedRconClient = null;

    // Add cron job execution tracking
    this.lastCronExecution = {
      supplyRun: null,
      tankFlags: null,
      supplyRunSuccess: false,
      tankFlagsSuccess: false,
      vehicleRemoval: null,
      vehicleRemovalSuccess: null,
      scheduledRestartWarning: null,
      scheduledRestartWarningSuccess: null,
      scheduledRestart: null,
      scheduledRestartSuccess: null,
    };
    this.isScheduledRestartRunning = false;

    // Add lua command manager
    this.luaCommandManager = new BotLuaCommandManager();

    // Set up client presence when ready
    this.client.once(Events.ClientReady, () => {
      console.log(`Bot logged in as ${this.client.user.tag}`);

      // Set a rich presence for the bot
      this.client.user.setPresence({
        activities: [
          {
            name: 'Zona Merah Project Z',
            type: ActivityType.Playing,
            state: 'Surviving in Raven Creek',
            details: 'Watching for zombies',
            assets: {
              largeImageKey: 'game_logo',
              largeImageText: 'Zona Merah Project Z',
              smallImageKey: 'character_icon',
              smallImageText: 'Admin Bot',
            },
          },
        ],
        status: 'online',
      });
    });


  }

  async login() {
    await this.client.login(this.token);
    // Rich Presence disabled - not needed for bot applications
    // this.setupRichPresence();
    return true;
  }

  // Discord Rich Presence is disabled because it's for user applications, not bots
  // Bots use the bot's presence status instead (setPresence)
  setupRichPresence() {
    console.log('Rich Presence feature is disabled for bot applications.');
    // const clientId = '1359414378692087838';
    // const rpc = new RPC.Client({ transport: 'ipc' });
    // ... rest of the code commented out
  }

  setupRconConnection(rconClient) {
    this.rconClient = rconClient;

    // Setup RCON heartbeat to keep connection alive
    this.startRconHeartbeat();

    // Return the wrapped rcon client with auto-reconnect
    return {
      send: async (command) => {
        try {
          console.log(`[RCON Wrapper] Sending command: "${command}"`);
          const result = await this.sendRconCommand(command);
          console.log(`[RCON Wrapper] Command result:`, result ? result.substring(0, 200) : '(empty)');
          return result;
        } catch (error) {
          console.error(`[RCON Wrapper] Command failed: ${error.message}`);

          // Try to reconnect and retry the command once
          if (
            error.message.includes('WebSocket') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('not connected') ||
            error.message.toLowerCase().includes('timeout')
          ) {
            console.log('Connection issue detected, attempting to reconnect...');

            try {
              await this.reconnectRcon();
              console.log('Reconnected to RCON, retrying command...');
              return await this.sendRconCommand(command);
            } catch (reconnectError) {
              throw new Error(`Failed to reconnect to RCON: ${reconnectError.message}`);
            }
          }

          throw error;
        }
      },
    };
  }

  startRconHeartbeat() {
    // Clear any existing interval
    if (this.rconHeartbeatInterval) {
      clearInterval(this.rconHeartbeatInterval);
    }

    // Set up a new heartbeat interval
    this.rconHeartbeatInterval = setInterval(async () => {
      try {
        const currentTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        console.log(`[RCON Heartbeat] Checking connection at ${currentTime}...`);

        // Check if client is connected before sending
        if (!this.rconClient || !this.rconClient.client) {
          console.log('[RCON Heartbeat] Client not connected, attempting reconnect...');
          await this.reconnectRcon();
        } else {
          await this.sendRconCommand('players');
          console.log('[RCON Heartbeat] ✓ Connection healthy');
        }
      } catch (error) {
        console.error(`[RCON Heartbeat] Failed: ${error.message}`);
        // Don't spam reconnection attempts
        if (!this.isReconnecting) {
          this.reconnectRcon().catch((e) => console.error(`[RCON Heartbeat] Reconnect failed: ${e.message}`));
        }
      }
    }, this.heartbeatIntervalTime);

    console.log(
      `RCON heartbeat started, interval: ${this.heartbeatIntervalTime / 1000} seconds - Current server time: ${new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Jakarta',
      })}`
    );
  }

  async sendRconCommand(command) {
    if (!this.rconClient) {
      throw new Error('RCON client not initialized');
    }

    // Check if client is connected, if not try to reconnect
    if (!this.rconClient.client) {
      console.log('[RCON] Client not connected, attempting to reconnect...');
      await this.reconnectRcon();
    }

    // Validate connection is actually working
    try {
      return await this.rconClient.send(command);
    } catch (error) {
      console.error('[RCON] Command failed, will attempt reconnect:', error.message);
      // Try one reconnect attempt
      await this.reconnectRcon();
      // Retry the command
      return await this.rconClient.send(command);
    }
  }

  async reconnectRcon() {
    if (this.isReconnecting) {
      console.log('[RCON] Reconnection already in progress, waiting...');
      // Wait for the current reconnection to finish
      let attempts = 0;
      while (this.isReconnecting && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      if (this.isReconnecting) {
        throw new Error('Reconnection timeout - another reconnection is stuck');
      }
      return; // Reconnection completed by another process
    }

    this.isReconnecting = true;

    try {
      console.log('[RCON] Attempting to reconnect to RCON server...');

      // First, disconnect if there's an existing connection
      if (this.rconClient && this.rconClient.client) {
        try {
          await this.rconClient.disconnect();
        } catch (e) {
          console.log('[RCON] Error disconnecting old client:', e.message);
        }
      }

      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reconnect
      await this.rconClient.connect();
      console.log('[RCON] Successfully reconnected to RCON server');
    } catch (error) {
      console.error('[RCON] Failed to reconnect:', error.message);
      throw error;
    } finally {
      this.isReconnecting = false;
    }
  }

  async runSshCommand(command) {
    const sshConfig = {
      host: process.env.OVH_SG_HOST,
      port: process.env.OVH_SG_PORT_SSH,
      username: process.env.OVH_SG_USERNAME,
      password: process.env.OVH_SG_PASSWORD,
    };

    const conn = new SSHClient();
    await new Promise((resolve, reject) => {
      conn
        .on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }

            stream.on('close', () => {
              conn.end();
              resolve();
            });
            stream.on('data', () => {});
            stream.stderr.on('data', () => {});
          });
        })
        .on('error', reject)
        .connect(sshConfig);
    });
  }

  async sendScheduledServerMessage(message) {
    if (!this.wrappedRconClient) {
      throw new Error('RCON wrapper not initialized');
    }
    await this.wrappedRconClient.send(`servermsg "${message}"`);
  }

  async runScheduledRestartCron() {
    const executionTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });

    if (this.isScheduledRestartRunning) {
      logger.warn(`[Cron] Scheduled restart skipped at ${executionTime}: restart already in progress.`);
      return;
    }

    this.isScheduledRestartRunning = true;

    try {
      try {
        await this.sendScheduledServerMessage('SERVER RESTART: Scheduled restart is starting now. Please reconnect shortly.');
      } catch (noticeError) {
        logger.error(`[Cron] Failed to send scheduled restart notice at ${executionTime}: ${noticeError.message}`);
      }

      await this.runSshCommand('./pzserver restart');
      this.lastRestartTime = Date.now();
      this.lastCronExecution.scheduledRestart = new Date();
      this.lastCronExecution.scheduledRestartSuccess = true;
      logger.info(`[Cron] Scheduled restart command sent at ${executionTime}`);
      await this.sendCronNotification('Scheduled Restart', true, executionTime);
    } catch (error) {
      this.lastCronExecution.scheduledRestart = new Date();
      this.lastCronExecution.scheduledRestartSuccess = false;
      logger.error(`[Cron] Scheduled restart failed at ${executionTime}: ${error.message}`);
      await this.sendCronNotification('Scheduled Restart', false, executionTime, error.message);
    } finally {
      this.isScheduledRestartRunning = false;
    }
  }

  getNextScheduledRestartInfo() {
    const restartHoursWib = [4, 12, 18, 21];
    const wibOffsetMs = 7 * 60 * 60 * 1000;
    const nowUtcMs = Date.now();

    // Convert "now" to WIB date components using UTC getters
    const nowWib = new Date(nowUtcMs + wibOffsetMs);
    const year = nowWib.getUTCFullYear();
    const month = nowWib.getUTCMonth();
    const date = nowWib.getUTCDate();

    // Midnight WIB in UTC milliseconds
    const todayMidnightWibUtcMs = Date.UTC(year, month, date, 0, 0, 0, 0) - wibOffsetMs;

    let nextRestartUtcMs = null;
    for (const hour of restartHoursWib) {
      const candidateUtcMs = todayMidnightWibUtcMs + hour * 60 * 60 * 1000;
      if (candidateUtcMs > nowUtcMs) {
        nextRestartUtcMs = candidateUtcMs;
        break;
      }
    }

    if (!nextRestartUtcMs) {
      const tomorrowMidnightWibUtcMs = todayMidnightWibUtcMs + 24 * 60 * 60 * 1000;
      nextRestartUtcMs = tomorrowMidnightWibUtcMs + restartHoursWib[0] * 60 * 60 * 1000;
    }

    return {
      nextRestartDate: new Date(nextRestartUtcMs),
      remainingMs: Math.max(0, nextRestartUtcMs - nowUtcMs),
    };
  }

  formatRemainingTime(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  setupEventListeners(rconClient, auctionLogMonitor = null) {
    // Set up RCON with auto-reconnect wrapper
    const wrappedRconClient = this.setupRconConnection(rconClient);

    // Store wrapped RCON client for cron jobs
    this.wrappedRconClient = wrappedRconClient;

    // Store auction log monitor for commands
    this.auctionLogMonitor = auctionLogMonitor;

    // Initialize lua command manager
    this.luaCommandManager.initialize(wrappedRconClient);

    // Setup cron jobs
    this.setupCronJobs();

    this.client.on(Events.MessageCreate, async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Check if message is in AI channel and doesn't start with prefix
      const aiChannelId = config.get('discord.aiChannelId');
      if (message.channel.id === aiChannelId && !message.content.startsWith(config.discord.prefix)) {
        // Auto-respond with AI in designated channel
        await this.handleAIChannelMessage(message);
        return;
      }

      const prefix = config.discord.prefix;

      // Check if message starts with prefix
      if (!message.content.startsWith(prefix)) return;

      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();

      // --- Development Mode Check ---
      const isDeveloper = message.member && message.member.roles.cache.some((role) => role.name.toLowerCase() === 'developer');
      const isAdmin = message.member && message.member.roles.cache.some((role) => role.name.toLowerCase() === 'admin');

      // If in dev mode, only allow developers and admins to use commands
      if (this.devMode && !isDeveloper && !isAdmin) {
        return message.channel.send('⚠️ Bot is currently in development mode. Only developers and admins can use commands.');
      }

      // Command to toggle dev mode (restricted to developers and admins)
      if (command === 'devmode') {
        if (!isDeveloper && !isAdmin) {
          return message.channel.send('❌ You need the @developer or @admin role to toggle development mode.');
        }

        // Toggle dev mode
        this.devMode = !this.devMode;
        return message.channel.send(
          `🔧 Development mode is now **${this.devMode ? 'ON' : 'OFF'}**. ${
            this.devMode ? 'Only developers and admins can use commands.' : 'All users can use commands.'
          }`
        );
      }

      // --- Cooldown check ---
      if (!isAdmin) {
        // Admins are immune to cooldown
        const now = Date.now();
        const cooldownKey = `${message.author.id}:${command}`;
        if (this.commandCooldowns.has(cooldownKey)) {
          const lastUsed = this.commandCooldowns.get(cooldownKey);
          if (now - lastUsed < this.cooldownTime) {
            const remaining = Math.ceil((this.cooldownTime - (now - lastUsed)) / 1000);
            return message.reply(`⏳ Please wait ${remaining} seconds before using \`${prefix}${command}\` again.`);
          }
        }
        this.commandCooldowns.set(cooldownKey, now);
      }

      // Handle commands
      // Check if command exists in our commands module
      const commandObj = commands.find(cmd =>
        cmd.name === command || (cmd.aliases && cmd.aliases.includes(command))
      );

      if (commandObj) {
        try {
          await commandObj.execute(message, args);
          return;
        } catch (error) {
          console.error(`Error executing command ${command}:`, error);
          message.channel.send('❌ Terjadi kesalahan saat menjalankan command. Silakan coba lagi nanti.');
          return;
        }
      }

      if (command === 'ping') {
        // Simple ping response
        const timeBefore = Date.now();
        const reply = await message.channel.send('Pinging...');
        const pingTime = Date.now() - timeBefore;
        reply.edit(`Pong! 🏓\nBot Latency: ${pingTime}ms\nAPI Latency: ${Math.round(this.client.ws.ping)}ms`);
      } else if (command === 'players') {
        try {
          const response = await wrappedRconClient.send('players');
          message.channel.send(`Players online: ${response || 'None'}`);
        } catch (error) {
          message.channel.send(`Error fetching players list: ${error.message}`);
          console.error(error);
        }
      } else if (command === 'restart') {
        try {
          // Set 4 hours cooldown (in ms)
          this.restartCooldown = 4 * 60 * 60 * 1000;
          this.requiredConfirmations = 5;

          // Check cooldown period (admins and developers are immune)
          if (this.lastRestartTime && !isAdmin && !isDeveloper) {
            const timeSinceLastRestart = Date.now() - this.lastRestartTime;
            if (timeSinceLastRestart < this.restartCooldown) {
              const remainingTime = this.restartCooldown - timeSinceLastRestart;
              const remainingMinutes = Math.ceil(remainingTime / (60 * 1000));
              return message.channel.send(`Server restart is on cooldown. Please wait ${remainingMinutes} more minutes before restarting again.`);
            }
          }

          // If admin or developer, skip confirmation and restart immediately
          if (isAdmin || isDeveloper) {
            await message.channel.send(`Server restart initiated by ${message.author.username} (${isDeveloper ? 'Developer' : 'Admin'})...`);
            try {
              // First warning via RCON
              await wrappedRconClient.send('servermsg "SERVER RESTART: Restart initiated by Admin. Server will restart in 3 minutes."');
              // Wait 2 minutes
              setTimeout(async () => {
                // Second warning via RCON
                await wrappedRconClient.send(
                  'servermsg "SERVER RESTART IMMINENT: Saving world and restarting in 1 minute. Please finish what you\'re doing!"'
                );
                // Wait 1 more minute, then restart via SSH
                setTimeout(async () => {
                  const sshConfig = {
                    host: process.env.OVH_SG_HOST,
                    port: process.env.OVH_SG_PORT_SSH,
                    username: process.env.OVH_SG_USERNAME,
                    password: process.env.OVH_SG_PASSWORD,
                  };
                  const conn = new SSHClient();
                  await new Promise((resolve, reject) => {
                    conn
                      .on('ready', () => {
                        conn.exec('./pzserver restart', (err, stream) => {
                          if (err) {
                            conn.end();
                            return reject(err);
                          }
                          stream.on('close', () => {
                            conn.end();
                            resolve();
                          });
                          stream.on('data', () => {});
                          stream.stderr.on('data', () => {});
                        });
                      })
                      .on('error', reject)
                      .connect(sshConfig);
                  });
                  await message.channel.send('In-game warnings sent. Server will restart now.');
                  this.lastRestartTime = Date.now();
                }, 60000); // 1 minute
              }, 120000); // 2 minutes
            } catch (restartError) {
              await message.channel.send(`Error during restart: ${restartError.message}`);
              console.error('Restart error:', restartError);
            }
            return;
          }

          // Non-admins: require confirmation
          setTimeout(async () => {
            // Track unique users for confirm and cancel
            const confirmedUsers = new Set();
            const canceledUsers = new Set();

            const confirmMsg = await message.channel.send(
              `**Force Restart Requested!**\n` +
                `This command is for emergency use only. If you want to restart for mod updates, please use \`!checkupdate\` instead.\n\n` +
                `**${confirmedUsers.size}/5** confirms | **${canceledUsers.size}/1** cancels\n` +
                `Type \`confirm\` or \`cancel\` within 120 seconds.\n` +
                `**Note:** At least 5 different users must confirm, or 1 must cancel.`
            );

            const filter = (m) => ['confirm', 'cancel'].includes(m.content.toLowerCase());
            const collector = message.channel.createMessageCollector({ filter, time: 120000 });

            collector.on('collect', async (m) => {
              const action = m.content.toLowerCase();
              if (action === 'confirm' && !confirmedUsers.has(m.author.id)) {
                confirmedUsers.add(m.author.id);
              }
              if (action === 'cancel' && !canceledUsers.has(m.author.id)) {
                canceledUsers.add(m.author.id);
              }

              // Update the confirmation message
              await confirmMsg.edit(
                `**Force Restart Requested!**\n` +
                  `This command is for emergency use only. If you want to restart for mod updates, please use \`!checkupdate\` instead.\n\n` +
                  `**${confirmedUsers.size}/5** confirms | **${canceledUsers.size}/1** cancels\n` +
                  `Type \`confirm\` or \`cancel\` within 120 seconds.\n` +
                  `**Note:** At least 5 different users must confirm, or 1 must cancel.`
              );

              // If enough cancels, stop collector and cancel
              if (canceledUsers.size >= 1) {
                collector.stop('canceled');
              }
              // If enough confirms, stop collector and proceed
              if (confirmedUsers.size >= 5) {
                collector.stop('confirmed');
              }
            });

            collector.on('end', async (collected, reason) => {
              if (reason === 'confirmed') {
                await message.channel.send(`Confirmed by ${confirmedUsers.size} users! Sending in-game warnings and initiating server restart...`);
                try {
                  // First warning via RCON
                  await wrappedRconClient.send('servermsg "SERVER RESTART: Restart initiated by Discord vote. Server will restart in 3 minutes."');
                  // Wait 2 minutes
                  setTimeout(async () => {
                    // Second warning via RCON
                    await wrappedRconClient.send(
                      'servermsg "SERVER RESTART IMMINENT: Saving world and restarting in 1 minute. Please finish what you\'re doing!"'
                    );
                    // Wait 1 more minute, then restart via SSH
                    setTimeout(async () => {
                      const sshConfig = {
                        host: process.env.OVH_SG_HOST,
                        port: process.env.OVH_SG_PORT_SSH,
                        username: process.env.OVH_SG_USERNAME,
                        password: process.env.OVH_SG_PASSWORD,
                      };
                      const conn = new SSHClient();
                      await new Promise((resolve, reject) => {
                        conn
                          .on('ready', () => {
                            conn.exec('./pzserver restart', (err, stream) => {
                              if (err) {
                                conn.end();
                                return reject(err);
                              }
                              stream.on('close', () => {
                                conn.end();
                                resolve();
                              });
                              stream.on('data', () => {});
                              stream.stderr.on('data', () => {});
                            });
                          })
                          .on('error', reject)
                          .connect(sshConfig);
                      });
                      await message.channel.send('In-game warnings sent. Server will restart now.');
                      this.lastRestartTime = Date.now();
                    }, 60000); // 1 minute
                  }, 120000); // 2 minutes
                } catch (restartError) {
                  await message.channel.send(`Error during restart: ${restartError.message}`);
                  console.error('Restart error:', restartError);
                }
              }
            });
          }, 1000); // 1 second delay before starting the confirmation process
        } catch (error) {
          message.channel.send(`Error initiating force restart: ${error.message}`);
          console.error('Error during restart command:', error);
        }
      } else if (command === 'checkupdate') {
        let statusMsg;
        try {
          console.log('[CheckUpdate] Command initiated by user:', message.author.tag);
          statusMsg = await message.channel.send('Checking for mod updates, please wait while im reading the log...');

          // Validate RCON connection before sending commands
          console.log('[CheckUpdate] Validating RCON connection...');
          if (!this.rconClient || !this.rconClient.client) {
            console.log('[CheckUpdate] RCON not connected, attempting reconnect...');
            try {
              await this.reconnectRcon();
              console.log('[CheckUpdate] RCON reconnected successfully');
            } catch (reconnectError) {
              console.error('[CheckUpdate] Failed to reconnect RCON:', reconnectError.message);
              await statusMsg.edit('⚠️ Warning: Could not connect to RCON, but will check logs anyway...');
              // Continue with log check even if RCON fails
            }
          }

          // Send the check command once and wait a bit for the server to write to log
          console.log('[CheckUpdate] Sending checkModsNeedUpdate command to server...');
          try {
            console.log('[CheckUpdate] Attempt 1/3...');
            const response1 = await wrappedRconClient.send('checkModsNeedUpdate');
            console.log('[CheckUpdate] Response 1:', response1);

            await new Promise(resolve => setTimeout(resolve, 500));

            console.log('[CheckUpdate] Attempt 2/3...');
            const response2 = await wrappedRconClient.send('checkModsNeedUpdate');
            console.log('[CheckUpdate] Response 2:', response2);

            await new Promise(resolve => setTimeout(resolve, 500));

            console.log('[CheckUpdate] Attempt 3/3...');
            const response3 = await wrappedRconClient.send('checkModsNeedUpdate');
            console.log('[CheckUpdate] Response 3:', response3);

            console.log('[CheckUpdate] All commands sent successfully');
          } catch (rconError) {
            console.error('[CheckUpdate] RCON send failed:', rconError.message);
            console.error('[CheckUpdate] Full RCON error:', rconError);
            await statusMsg.edit('⚠️ Warning: Could not send RCON command, but will check logs anyway...');
          }
          console.log('[CheckUpdate] Waiting 3 seconds for log to update...');
          await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3 seconds

          // Add timeout to prevent hanging
          console.log('[CheckUpdate] Starting SFTP log scan with 30s timeout...');
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Mod update check timed out after 30 seconds')), 30000)
          );

          const result = await Promise.race([
            this.sftpLogReader.checkForModUpdates(),
            timeoutPromise
          ]);
          console.log('[CheckUpdate] SFTP scan completed. Result:', JSON.stringify(result, null, 2));

          if (result && result.success) {
            console.log('[CheckUpdate] Success! needsUpdate:', result.needsUpdate);
            await statusMsg.edit(`Mod update check result: **${result.message}**`);
            if (result?.needsUpdate) {
              console.log('[CheckUpdate] Mod update detected! Initiating restart sequence...');
              await message.channel.send('Mod update detected! Restarting server...');
              try {
                // First warning via RCON
                await wrappedRconClient.send('servermsg "SERVER RESTART: Restart initiated due to mod update. Server will restart in 3 minutes."');
                await message.channel.send('In-game notification sent. Waiting 2 minutes before next warning...');

                // Wait 2 minutes
                await new Promise((resolve) => setTimeout(resolve, 120000));

                // Second warning via RCON
                await wrappedRconClient.send(
                  'servermsg "SERVER RESTART IMMINENT: Saving world and restarting in 1 minute. Please finish what you\'re doing!"'
                );
                await message.channel.send('Final warning sent. Restarting server in 1 minute...');

                // Wait 1 more minute, then restart via SSH
                setTimeout(async () => {
                  const sshConfig = {
                    host: process.env.OVH_SG_HOST,
                    port: process.env.OVH_SG_PORT_SSH,
                    username: process.env.OVH_SG_USERNAME,
                    password: process.env.OVH_SG_PASSWORD,
                  };
                  const conn = new SSHClient();
                  await new Promise((resolve, reject) => {
                    conn
                      .on('ready', () => {
                        conn.exec('./pzserver restart', (err, stream) => {
                          if (err) {
                            conn.end();
                            return reject(err);
                          }
                          stream.on('close', () => {
                            conn.end();
                            resolve();
                          });
                          stream.on('data', () => {});
                          stream.stderr.on('data', () => {});
                        });
                      })
                      .on('error', reject)
                      .connect(sshConfig);
                  });
                  await message.channel.send('Server restart command sent. Server will restart now.');
                  this.lastRestartTime = Date.now();
                }, 60000); // 1 minute
              } catch (restartError) {
                await message.channel.send(`Error during restart: ${restartError.message}`);
                console.error('Restart error:', restartError);
              }
            }
          } else {
            console.log('[CheckUpdate] Check failed or unsuccessful. Result:', result);
            await statusMsg.edit(`Mod update check result: **${result.message || 'Unknown error'}**`);
          }
        } catch (err) {
          console.error('[CheckUpdate] ERROR in !checkupdate:', err);
          console.error('Full error details:', err);
          if (statusMsg) {
            try {
              await statusMsg.edit(`❌ Error checking mod updates: ${err.message}`);
            } catch (editError) {
              console.error('[CheckUpdate] Failed to edit status message:', editError);
              await message.channel.send(`❌ Error checking mod updates: ${err.message}`);
            }
          } else {
            await message.channel.send(`❌ Error checking mod updates: ${err.message}`);
          }
        }
      } else if (command === 'killboard') {
        try {
          const statusMsg = await message.channel.send('Fetching killboard, please wait...');
          const result = await this.sftpLogReader.getKillBoard('ZonaMerah_KillCounts.ini');
          if (result && result.length > 0) {
            let reply = '**🏆 Top 10 Killboard 🏆**\n\n```';
            result.forEach((entry, idx) => {
              reply += `\n${idx + 1}. ${entry.name} — ${entry.kills} kills`;
            });
            reply += '\n```';
            reply += '*Note: This records is not real time data.*';
            await statusMsg.edit(reply);
          } else {
            await statusMsg.edit('No kill data found.');
          }
        } catch (err) {
          message.channel.send(`Error fetching killboard: ${err.message}`);
          console.error('Error in !killboard:', err);
        }
      } else if (command === 'killboardrc') {
        try {
          const statusMsg = await message.channel.send('Fetching RavenCreek killboard, please wait...');
          // Use a different filename for RavenCreek killboard
          const result = await this.sftpLogReader.getKillBoard('ZonaMerah_RavenCreekKillCounts.ini');
          if (result && result.length > 0) {
            let reply = '**🏆 RavenCreek Top 10 (Raven Creek Champion) 🏆**\n\n```';
            result.slice(0, 10).forEach((entry, idx) => {
              reply += `\n${idx + 1}. ${entry.name} — ${entry.kills} kills`;
            });
            reply += '\n```';
            reply += '*Note: This record is not real time data.*';
            await statusMsg.edit(reply);
          } else {
            await statusMsg.edit('No RavenCreek kill data found.');
          }
        } catch (err) {
          message.channel.send(`Error fetching RavenCreek killboard: ${err.message}`);
          console.error('Error in !rckillboard:', err);
        }
      } else if (command === 'wdauction') {
        try {
          // Get the user's Discord ID
          const discordId = message.author.username;

          // Query zmuser table to get the username1
          const user = await ZMUser.findOne({
            where: { discordid: discordId }
          });

          if (!user || !user.username1) {
            return message.channel.send('❌ You are not registered in the system or no username found. Please contact an admin.');
          }

          const username = user.username1;

          // Check if player is currently online by getting players list
          const playersResponse = await wrappedRconClient.send('players');
          const onlinePlayers = playersResponse ? playersResponse.split('\n').filter(line => line.trim()) : [];

          // Check if the username is in the online players list
          const isOnline = onlinePlayers.some(player => player.toLowerCase().includes(username.toLowerCase()));

          if (!isOnline) {
            return message.channel.send(`❌ Player "${username}" is not currently online. You must be in-game to withdraw auction points.`);
          }

          // Execute the lua command to withdraw auction points
          const luaCommand = `luacmd clientexe ${username} withdrawauctionpoints`;
          const response = await wrappedRconClient.send(luaCommand);

          message.channel.send(`✅ Auction points withdrawal command sent for "${username}". ${response || ''}`);
          console.log(`[WDAuction] Command executed for ${username} (Discord: ${discordId}): ${luaCommand}`);

        } catch (err) {
          message.channel.send(`❌ Error processing auction withdrawal: ${err.message}`);
          console.error('Error in !wdauction:', err);
        }
      } else if (command === 'adduser') {
        // Check if user has admin role
        if (!message.member.roles.cache.some((role) => role.name.toLowerCase() === 'admin')) {
          return message.channel.send('❌ You need the @admin role to use this command.');
        }

        // Check if the user has provided both username and password
        if (args.length < 2) {
          return message.channel.send('❌ Missing arguments! Usage: `!adduser <username> <password>`');
        }

        const username = args[0];
        const password = args[1];

        // Optional Discord ID if mentioning a user
        let discordId = null;
        if (message.mentions.users.size > 0) {
          discordId = message.mentions.users.first().id;
        }

        try {
          // Send the adduser command to the server
          const response = await wrappedRconClient.send(`adduser "${username}" "${password}"`);

          // Also store in database
          try {
            await zmUsersDb.addUser({
              discordid: discordId,
              username1: username,
              password1: password,
              extradata: `Added by ${message.author.tag} on ${new Date().toISOString()}`,
            });

            message.channel.send(`✅ User command executed: ${response || 'Command sent, but no response received.'} User also added to database.`);
          } catch (dbError) {
            console.error('Database error when adding user:', dbError);
            message.channel.send(`✅ User added to server, but failed to add to database: ${dbError.message}`);
          }

          // For security, try to delete the original message that contains the password
          try {
            if (message.deletable) {
              await message.delete();
              message.channel.send('Original message deleted for security.');
            }
          } catch (deleteError) {
            console.error('Failed to delete message containing password:', deleteError);
          }
        } catch (error) {
          message.channel.send(`❌ Error adding user: ${error.message}`);
          console.error('Error adding user:', error);
        }
      } else if (command === 'removeuserfromwhitelist') {
        // Check if user has admin role
        if (!message.member.roles.cache.some((role) => role.name.toLowerCase() === 'admin')) {
          return message.channel.send('❌ You need the @admin role to use this command.');
        }

        // Check if the user has provided a username
        if (args.length < 1) {
          return message.channel.send('❌ Missing arguments! Usage: `!removeuserfromwhitelist <username>`');
        }

        const username = args[0];

        try {
          // Send the removeuserfromwhitelist command to the server
          const response = await wrappedRconClient.send(`removeuserfromwhitelist "${username}"`);
          message.channel.send(`✅ User removed from whitelist: ${response || 'Command sent, but no response received.'}`);
        } catch (error) {
          message.channel.send(`❌ Error removing user from whitelist: ${error.message}`);
          console.error('Error removing user from whitelist:', error);
        }
      } else if (command === 'topplaytime') {
        try {
          const statusMsg = await message.channel.send('Fetching top players by playtime from BattleMetrics...');
          const players = await this.battlemetrics.getTopPlayersByPlaytime(10);
          if (players && players.length > 0) {
            let reply = '**⏱️ Top 10 Players by Playtime (BattleMetrics)**\n\n```';
            players.forEach((player, idx) => {
              // Convert seconds to hours:minutes
              const hours = Math.floor(player.time / 3600);
              const minutes = Math.floor((player.time % 3600) / 60);
              reply += `\n${idx + 1}. ${player.name} — ${hours}h ${minutes}m`;
            });
            reply += '\n```';
            reply += '\nNotes: *This Data is taken from BattleMetrics, and may not be real time data.*';
            await statusMsg.edit(reply);
          } else {
            await statusMsg.edit('No playtime data found.');
          }
        } catch (err) {
          message.channel.send(`Error fetching playtime data: ${err.message}`);
          console.error('Error in !topplaytime:', err);
        }
      } else if (command === 'cronstatus') {
        // Check if user has admin or developer role
        if (!isDeveloper && !isAdmin) {
          return message.channel.send('You need the @developer or @admin role to check cron job status.');
        }

        const now = new Date();
        const wibTime = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });

        let statusMessage = `**Cron Job Status Report**\n`;
        statusMessage += `**Current Time (WIB):** ${wibTime}\n\n`;

        const activeCronJobs = [
          {
            name: 'Vehicle Removal Checker',
            schedule: `Every ${config.get('autoshop.checkIntervalMinutes') || 1} minute(s)`,
            lastRun: this.lastCronExecution.vehicleRemoval,
            success: this.lastCronExecution.vehicleRemovalSuccess,
          },
          {
            name: 'Scheduled Restart Warning',
            schedule: '03:59, 11:59, 17:59, 20:59 WIB',
            lastRun: this.lastCronExecution.scheduledRestartWarning,
            success: this.lastCronExecution.scheduledRestartWarningSuccess,
          },
          {
            name: 'Scheduled Server Restart',
            schedule: '04:00, 12:00, 18:00, 21:00 WIB',
            lastRun: this.lastCronExecution.scheduledRestart,
            success: this.lastCronExecution.scheduledRestartSuccess,
          },
        ];

        for (const job of activeCronJobs) {
          statusMessage += `**${job.name}:**\n`;
          statusMessage += `- Schedule: ${job.schedule}\n`;

          if (job.lastRun) {
            const lastRunWib = job.lastRun.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
            statusMessage += `- Last Execution: ${lastRunWib}\n`;
            statusMessage += `- Last Status: ${job.success ? 'SUCCESS' : 'FAILED'}\n\n`;
          } else {
            statusMessage += `- Last Status: Not executed since bot started\n\n`;
          }
        }

        const { nextRestartDate, remainingMs } = this.getNextScheduledRestartInfo();
        const nextRestartWib = nextRestartDate.toLocaleString('en-US', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        statusMessage += `**Next Scheduled Restart:** ${nextRestartWib} WIB\n`;
        statusMessage += `**Time Remaining:** ${this.formatRemainingTime(remainingMs)}\n`;
        statusMessage += `**Timezone:** Asia/Jakarta (UTC+7)`;

        message.channel.send(statusMessage);
      } else if (command === 'testcron') {
        // Check if user has admin or developer role
        if (!isDeveloper && !isAdmin) {
          return message.channel.send('❌ You need the @developer or @admin role to test cron jobs.');
        }

        if (args.length < 1) {
          return message.channel.send('❌ Usage: `!testcron <supply|tank|both>` - Manually trigger cron job for testing');
        }

        const jobType = args[0].toLowerCase();
        const executionTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });

        if (jobType === 'supply' || jobType === 'both') {
          try {
            await message.channel.send('🧪 **Testing Supply Run Reset...**');

            const flagUpdates = {
              supplyRunAvailableFlag: 1,
              supplyRunCompleted: 0,
            };

            await this.sftpLogReader.updateMultipleServerFlags(flagUpdates);

            this.lastCronExecution.supplyRun = new Date();
            this.lastCronExecution.supplyRunSuccess = true;

            await message.channel.send('✅ **Supply Run Reset Test Completed Successfully!**');

            // Send server message
            try {
              await this.wrappedRconClient.send('servermsg "Supply Run has been reset! (Manual Test) New supply runs are now available."');
            } catch (msgError) {
              console.warn('Could not send server message:', msgError.message);
            }
          } catch (error) {
            this.lastCronExecution.supplyRun = new Date();
            this.lastCronExecution.supplyRunSuccess = false;
            await message.channel.send(`❌ **Supply Run Reset Test Failed:** ${error.message}`);
          }
        }

        if (jobType === 'tank' || jobType === 'both') {
          try {
            await message.channel.send('🧪 **Testing global flags Reset...**');

            const tankFlagUpdates = {
              randomizedWorldBoss_day: false,
              supplyRun_Jessica_taken: false,
            };

            await this.sftpLogReader.updateGlobalFlags(tankFlagUpdates);

            this.lastCronExecution.tankFlags = new Date();
            this.lastCronExecution.tankFlagsSuccess = true;

            await message.channel.send('✅ **global flags Reset Test Completed Successfully!**');

            // Send server message
            try {
              await this.wrappedRconClient.send('servermsg "Daily tank events have been reset! (Manual Test) Tank spawns are now available again."');
            } catch (msgError) {
              console.warn('Could not send tank reset server message:', msgError.message);
            }
          } catch (error) {
            this.lastCronExecution.tankFlags = new Date();
            this.lastCronExecution.tankFlagsSuccess = false;
            await message.channel.send(`❌ **global flags Reset Test Failed:** ${error.message}`);
          }
        }

        if (jobType !== 'supply' && jobType !== 'tank' && jobType !== 'both') {
          return message.channel.send('❌ Invalid job type. Use: `!testcron <supply|tank|both>`');
        }
      } else if (command === 'help') {
        const prefix = config.discord.prefix;

        // General Commands Message
        let generalCommands = '**🤖 Zona Merah Project Z - Command List 🤖**\n\n';
        generalCommands += '**General Commands:**\n';
        generalCommands += `\`${prefix}help\` - Shows this help message\n`;
        generalCommands += `\`${prefix}ping\` - Check bot response time\n`;
        generalCommands += `\`${prefix}players\` - Show currently online players\n`;
        generalCommands += `\`${prefix}restart\` - Initiate server restart (requires ${this.requiredConfirmations} user confirmations)\n`;
        generalCommands += `\`${prefix}start\` - Start the server (requires confirmations or admin)\n`;
        generalCommands += `\`${prefix}checkupdate\` - Check for mod updates\n`;
        generalCommands += `\`${prefix}serverinfo\` - Display server info from BattleMetrics\n`;
  generalCommands += `\`${prefix}syncpoint\` - Refresh your points file from the game server (use before bidding if asked)\n`;

        // Whitelist Commands Message
        let whitelistCommands = '**Whitelist Commands:**\n';
        whitelistCommands += `\`${prefix}whitelistrequest <steamid> <username> <password>\` - Request to be whitelisted. Your Discord account and username must not already be registered. Your message will be deleted for security.\n`;
        whitelistCommands += `\`${prefix}resetpassword <oldpassword> <newpassword>\` - Reset your whitelist password. You must provide your current password. Your message will be deleted for security.\n\n`;
        whitelistCommands += '**How to Whitelist:**\n';
        whitelistCommands += '1. Use the command above with your SteamID64, desired username, and password.\n';
        whitelistCommands += '2. Example: `!whitelistrequest 76561198000000000 MyUsername MyPassword`\n';
        whitelistCommands += '3. **For usernames with spaces:** `!whitelistrequest 76561198000000000 My Game Name MyPassword`\n';
        whitelistCommands +=
          '4. Your message will be deleted for your safety. If successful, you will be whitelisted and given the Whitelisted role.\n';
        whitelistCommands += '**Note:** Please do whitelistrequest in the Support Ticket Channel, so your data is not **EXPOSED**.\n';

        // Wallet and Admin Commands Message
        let otherCommands = '**S3 Wallet Commands:**\n';
        otherCommands += `\`${prefix}checkdeposit\` - Check your point deposit (Change your display name to your in-game name)\n`;
        otherCommands += `\`${prefix}checkraiddeposit\` - Check your raid points deposit (Change your display name to your in-game name)\n\n`;

        otherCommands += '**Auction Commands:**\n';
        otherCommands += `Auction listings are automatically posted from the game server.\n\n`;

        otherCommands += '**Admin Commands:**\n';
        otherCommands += `\`${prefix}adduser <username> <password>\` - Add a user to the whitelist (requires @admin role)\n`;
        otherCommands += `\`${prefix}removeuserfromwhitelist <username>\` - Remove a user from the whitelist (requires @admin role)\n`;
        otherCommands += `\`${prefix}devhelp\` - Show developer/admin commands for ZM_ClientExecutor (requires @admin/@developer role)\n`;
        otherCommands += `\`${prefix}cronstatus\` - Check cron job execution status (requires @admin/@developer role)\n`;
        otherCommands += `\`${prefix}testcron <supply|tank|both>\` - Manually test cron jobs (requires @admin/@developer role)\n\n`;
        otherCommands += '**Note:** Server commands may take a moment to process depending on server load.';

        // Send all messages
        await message.channel.send(generalCommands);
        await message.channel.send(whitelistCommands);
        await message.channel.send(otherCommands);
      } else if (command === 'serverinfo') {
        try {
          const statusMsg = await message.channel.send('Fetching server info via SSH...');

          // Use SSH to execute the detail command
          const sshConfig = {
            host: process.env.OVH_SG_HOST,
            port: process.env.OVH_SG_PORT_SSH,
            username: process.env.OVH_SG_USERNAME,
            password: process.env.OVH_SG_PASSWORD,
          };

          const conn = new SSHClient();
          let serverDetails = '';

          await new Promise((resolve, reject) => {
            conn
              .on('ready', () => {
                conn.exec('./pzserver details', (err, stream) => {
                  if (err) {
                    conn.end();
                    return reject(err);
                  }

                    stream.on('data', (data) => {
                    serverDetails += data.toString();
                    // Override specific Internet IP if present in the stream
                    serverDetails = serverDetails.replace(/Internet IP:\s*69\.162\.93\.50/g, 'Internet IP: 5.56.25.22');
                    });

                  stream.on('close', () => {
                    conn.end();
                    resolve();
                  });

                  stream.stderr.on('data', (data) => {
                    console.error(`SSH stderr: ${data.toString()}`);
                  });
                });
              })
              .on('error', reject)
              .connect(sshConfig);
          });

          // Strip ANSI color codes
          serverDetails = serverDetails.replace(/\x1B\[\d+m/g, '');

          // Parse only the requested information
          let reply = `**🖥️ Zona Merah Server Info**\n\n`;

          // Extract information with updated regex patterns
          const serverName = serverDetails.match(/Server Name:\s+(.*?)(?:\r?\n|$)/);
          const status = serverDetails.match(/Status:\s+(.*?)(?:\r?\n|$)/);
          const internetIP = serverDetails.match(/Internet IP:\s+(.*?)(?:\r?\n|$)/);
          const memUsed = serverDetails.match(/Mem Used:\s+(.*?)(?:\r?\n|$)/);
          const cpuUsed = serverDetails.match(/CPU Used:\s+(.*?)(?:\r?\n|$)/);

          if (serverName) reply += `**Server Name:** ${serverName[1]}\n`;
          if (status) reply += `**Status:** ${status[1]}\n`;
          if (internetIP) reply += `**Internet IP:** ${internetIP[1]}\n`;
          if (cpuUsed) reply += `**CPU Usage:** ${cpuUsed[1]}\n`;
          if (memUsed) {
            // Extract only the percentage part, removing the MB value
            const memUsedPercentage = memUsed[1].split(' ')[0];
            reply += `**Memory Usage:** ${memUsedPercentage}\n`;
          }

          await statusMsg.edit(reply);
        } catch (err) {
          message.channel.send(`Error fetching server info: ${err.message}`);
          console.error('Error in !serverinfo:', err);
        }
      } else if (command === 'checkdeposit' || command === 'checkraiddeposit') {
        // Remove cooldown for checkdeposit and checkraiddeposit

        // If no username argument, use the requester's Discord username
        const username = message.member?.displayName || message.author.username;
        try {
          await message.react('📩');
          if (command === 'checkdeposit') {
            await message.channel.send(`Checking deposit for **${username}**, ill send you a DM, please use display name as your in-game name`);
            const total = await this.sftpLogReader.getServerPointDepositByUsername(username);
            await message.author.send(`💰 **${username}** has deposited a total of **${total.toLocaleString()}** points.`);
          } else {
            await message.channel.send(`Checking raid deposit for **${username}**, ill send you a DM, please use display name as your in-game name`);
            const total = await this.sftpLogReader.getRaidPointsDepositByUsername(username);
            await message.author.send(`🪓 **${username}** has deposited a total of **${total.toLocaleString()}** raid points.`);
          }
        } catch (err) {
          try {
            await message.author.send(`Error checking ${command === 'checkdeposit' ? 'deposit' : 'raid deposit'}: ${err.message}`);
          } catch {
            message.channel.send('❌ Unable to send you a DM. Please check your privacy settings.');
          }
          console.error(`Error in !${command}:`, err);
        }
      } else if (command === 'syncpoint') {
        // Allow all users to trigger a points file refresh
        const provided = args.length > 0 ? args.join(' ') : null;
        const derived = message.member?.displayName || message.author.username;
        const username = (provided || derived || '').trim();

        if (!username) {
          return message.channel.send('❌ Unable to determine username. Provide one like `!syncpoint MyPlayerName`');
        }

        // Basic sanity check (avoid accidental huge injections). Allow spaces but limit length.
        if (username.length > 40) {
          return message.channel.send('❌ Username seems to long. Please check and try again.');
        }

        try {
          await message.channel.send(`🔄 Syncing points for **${username}**... (this usually takes ~5 seconds)`);
          await wrappedRconClient.send(`luacmd clientexe ${username} dumpPlayerPoints`);
          await message.channel.send(`✅ Points sync requested for **${username}**. Try your auction action again shortly.`);
        } catch (error) {
          console.error('Error executing syncpoint command:', error);
          await message.channel.send(`❌ Failed to sync points for **${username}**: ${error.message}`);
        }
      } else if (command === 'start') {
        try {
          // If admin or developer, start immediately without voting
          if (isDeveloper || isAdmin) {
            await message.channel.send(`Server start initiated by ${message.author.username} (${isDeveloper ? 'Developer' : 'Admin'})...`);

            try {
              const sshConfig = {
                host: process.env.OVH_SG_HOST,
                port: process.env.OVH_SG_PORT_SSH,
                username: process.env.OVH_SG_USERNAME,
                password: process.env.OVH_SG_PASSWORD,
              };

              const conn = new SSHClient();
              await new Promise((resolve, reject) => {
                conn
                  .on('ready', () => {
                    conn.exec('./pzserver start', (err, stream) => {
                      if (err) {
                        conn.end();
                        return reject(err);
                      }
                      stream.on('close', () => {
                        conn.end();
                        resolve();
                      });
                      stream.on('data', () => {});
                      stream.stderr.on('data', () => {});
                    });
                  })
                  .on('error', reject)
                  .connect(sshConfig);
              });

              await message.channel.send('✅ Server start command sent via SSH. Server should be online shortly.');
            } catch (startError) {
              await message.channel.send(`❌ Error during server start: ${startError.message}`);
              console.error('Start error:', startError);
            }

            return;
          }

          // For regular users, require voting
          // Set 4 hours cooldown (in ms)
          this.startCooldown = 4 * 60 * 60 * 1000;
          this.requiredConfirmations = 3;

          // Check cooldown period
          if (this.lastStartTime) {
            const timeSinceLastStart = Date.now() - this.lastStartTime;
            if (timeSinceLastStart < this.startCooldown) {
              const remainingTime = this.startCooldown - timeSinceLastStart;
              const remainingMinutes = Math.ceil(remainingTime / (60 * 1000));
              return message.channel.send(`Server start is on cooldown. Please wait ${remainingMinutes} more minutes before starting again.`);
            }
          }

          // Track unique users for confirm and cancel
          const confirmedUsers = new Set();
          const canceledUsers = new Set();

          const confirmMsg = await message.channel.send(
            `**Server Start Requested!**\n` +
              `**${confirmedUsers.size}/3** confirms | **${canceledUsers.size}/1** cancels\n` +
              `Type \`confirm\` or \`cancel\` within 120 seconds.\n` +
              `**Note:** At least 3 different users must confirm, or 1 must cancel.`
          );

          const filter = (m) => ['confirm', 'cancel'].includes(m.content.toLowerCase());
          const collector = message.channel.createMessageCollector({ filter, time: 120000 });

          collector.on('collect', async (m) => {
            const action = m.content.toLowerCase();
            if (action === 'confirm' && !confirmedUsers.has(m.author.id)) {
              confirmedUsers.add(m.author.id);
            }
            if (action === 'cancel' && !canceledUsers.has(m.author.id)) {
              canceledUsers.add(m.author.id);
            }

            // Update the confirmation message
            await confirmMsg.edit(
              `**Server Start Requested!**\n` +
                `**${confirmedUsers.size}/3** confirms | **${canceledUsers.size}/1** cancels\n` +
                `Type \`confirm\` or \`cancel\` within 120 seconds.\n` +
                `**Note:** At least 3 different users must confirm, or 1 must cancel.`
            );

            // If enough cancels, stop collector and cancel
            if (canceledUsers.size >= 1) {
              collector.stop('canceled');
            }
            // If enough confirms, stop collector and proceed
            if (confirmedUsers.size >= 3) {
              collector.stop('confirmed');
            }
          });

          collector.on('end', async (collected, reason) => {
            if (reason === 'canceled') {
              await confirmMsg.edit(`**Server Start Canceled!** (${canceledUsers.size} user canceled)`);
              return;
            } else if (reason === 'confirmed') {
              await message.channel.send(`Confirmed by ${confirmedUsers.size} users! Starting server...`);

              try {
                const sshConfig = {
                  host: process.env.OVH_SG_HOST,
                  port: process.env.OVH_SG_PORT_SSH,
                  username: process.env.OVH_SG_USERNAME,
                  password: process.env.OVH_SG_PASSWORD,
                };

                const conn = new SSHClient();
                await new Promise((resolve, reject) => {
                  conn
                    .on('ready', () => {
                      conn.exec('./pzserver start', (err, stream) => {
                        if (err) {
                          conn.end();
                          return reject(err);
                        }
                        stream.on('close', () => {
                          conn.end();
                          resolve();
                        });
                        stream.on('data', () => {});
                        stream.stderr.on('data', () => {});
                      });
                    })
                    .on('error', reject)
                    .connect(sshConfig);
                });

                await message.channel.send('✅ Server start command sent via SSH. Server should be online shortly.');
                this.lastStartTime = Date.now();
              } catch (startError) {
                await message.channel.send(`❌ Error during server start: ${startError.message}`);
                console.error('Start error:', startError);
              }
            } else {
              await confirmMsg.edit('**Server Start Request Timed Out!** Not enough confirmations received within the time limit.');
            }
          });
        } catch (error) {
          message.channel.send(`Error initiating server start: ${error.message}`);
          console.error('Error during start command:', error);
        }
      } else if (command === 'whitelistrequest') {

        if (args.length < 3) {
          try {
            if (message.deletable) await message.delete();
          } catch (e) {
            console.error('Failed to delete message with sensitive info:', e);
          }
          return message.channel.send('❌ Missing arguments! Usage: `!whitelistrequest <steamid> <username1> <password1>`\n' +
                                    '**Note:** If your username has spaces, put everything between steamid and password.\n' +
                                    'Example: `!whitelistrequest 76561198000000000 My Game Name mypassword123`');
        }

        const steamid = args[0];
        const password1 = args[args.length - 1]; // Last argument is always password
        const username1 = args.slice(1, -1).join(' '); // Everything between steamid and password
        const discordid = message.author.tag;
        const discordUserId = message.author.id;

        // Validate that we have a proper username (not empty after joining)
        if (!username1.trim()) {
          try {
            if (message.deletable) await message.delete();
          } catch (e) {
            console.error('Failed to delete message with sensitive info:', e);
          }
          return message.channel.send('❌ Invalid username! Please provide a valid username between steamid and password.');
        }

        // Validate SteamID64 (17 digits, all numbers)
        function isValidSteamID(steamid) {
          return /^\d{17}$/.test(steamid);
        }

        // Always try to delete the original message for security
        try {
          if (message.deletable) await message.delete();
        } catch (e) {
          console.error('Failed to delete message with sensitive info:', e);
        }

        if (!isValidSteamID(steamid)) {
          return message.channel.send('❌ Invalid SteamID! Please enter a valid 17-digit SteamID64 (numbers only).');
        }

        try {
          // Check how many accounts this Discord ID already has (allow up to 2)
          const existingUsersForDiscord = await zmUsersDb.findUsersByDiscordId(discordid);
          const existingByUsername = zmUsersDb.findUserByUsername ? await zmUsersDb.findUserByUsername(username1) : null;

          if (existingUsersForDiscord && existingUsersForDiscord.length >= 2) {
            return message.channel.send('❌ Batas pendaftaran tercapai: Akun Discord Anda sudah terdaftar pada 2 whitelist. Hubungi admin jika butuh tambahan.');
          }
          if (existingByUsername) {
            return message.channel.send('❌ This username is already registered in the whitelist database.');
          }

          // 1. Remove user from whitelist (if exists)
          try {
            await wrappedRconClient.send(`removeuserfromwhitelist "${username1}"`);
          } catch (e) {
            // Ignore errors, user might not exist yet
            console.warn(`removeuserfromwhitelist failed for ${username1}:`, e.message);
          }

          // 2. Add user to whitelist
          await wrappedRconClient.send(`adduser "${username1}" "${password1}"`);

          // 3. Insert data to Supabase. If this is the second account for this Discord
          //    populate the new row's username2 with the first account's username1.
          let username2ForNew = null;
          if (existingUsersForDiscord && existingUsersForDiscord.length >= 1) {
            username2ForNew = existingUsersForDiscord[0].username1 || null;
          }

          await zmUsersDb.addUser({
            discordid: discordid,
            steamid: steamid,
            username1: username1,
            username2: username2ForNew,
            password1: password1,
            extradata: `Requested by ${message.author.tag} on ${new Date().toISOString()}`,
          });

          // 4. Give "Whitelisted" role to the user
          const whitelistedRole = message.guild.roles.cache.find((role) => role.name.toLowerCase() === 'whitelisted');
          if (whitelistedRole) {
            try {
              const member = await message.guild.members.fetch(discordUserId);
              if (member && !member.roles.cache.has(whitelistedRole.id)) {
                await member.roles.add(whitelistedRole);
              }
            } catch (roleErr) {
              console.error('Failed to assign Whitelisted role:', roleErr);
              await message.channel.send('✅ Whitelist request processed, but failed to assign Whitelisted role. Please contact an admin.');
              return;
            }
          }

          message.channel.send('✅ Whitelist request processed! You are now whitelisted and have been given the Whitelisted role.');
        } catch (err) {
          console.error('Error processing whitelist request:', err);
          let errorMsg = '❌ Error processing whitelist request.';
          if (err.message) errorMsg += ` Reason: ${err.message}`;
          message.channel.send(errorMsg);
        }
      } else if (command === 'resetpassword') {
        // Usage: !resetpassword <oldpassword> <newpassword>
        if (args.length < 2) {
          try {
            if (message.deletable) await message.delete();
          } catch (e) {
            console.error('Failed to delete message with sensitive info:', e);
          }
          return message.channel.send('❌ Missing arguments! Usage: `!resetpassword <oldpassword> <newpassword>`');
        }

        const [oldPassword, newPassword] = args;
        const discordid = message.author.tag;

        // Always try to delete the original message for security
        try {
          if (message.deletable) await message.delete();
        } catch (e) {
          console.error('Failed to delete message with sensitive info:', e);
        }

        try {
          // Find user by Discord ID
          const user = await zmUsersDb.findUserByDiscordId(discordid);

          if (!user) {
            return message.channel.send('❌ No whitelist entry found for your Discord account.');
          }

          const username = user.username1;

          if (!username) {
            return message.channel.send('❌ No username found for your whitelist entry.');
          }

          // Check if old password matches
          if (user.password1 !== oldPassword) {
            return message.channel.send('❌ The old password you entered is incorrect.');
          }

          // 1. Remove user from whitelist (ignore errors)
          try {
            await wrappedRconClient.send(`removeuserfromwhitelist "${username}"`);
          } catch (e) {
            // Ignore errors, user might not exist yet
            console.warn(`removeuserfromwhitelist failed for ${username}:`, e.message);
          }

          // 2. Add user with new password
          await wrappedRconClient.send(`adduser "${username}" "${newPassword}"`);

          // 3. Update password in Supabase
          await zmUsersDb.updateUserPasswordByDiscordId(discordid, newPassword);

          message.channel.send('✅ Password reset successful! Your whitelist password has been updated.');
        } catch (err) {
          console.error('Error processing password reset:', err);
          let errorMsg = '❌ Error processing password reset.';
          if (err.message) errorMsg += ` Reason: ${err.message}`;
          message.channel.send(errorMsg);
        }
      } else if (command.startsWith('dev')) {
        // Check if user has admin or developer role
        if (!isDeveloper && !isAdmin) {
          return message.channel.send('❌ You need the @developer or @admin role to use developer commands.');
        }

        const devCommand = command.substring(3); // Remove 'dev' prefix

        if (devCommand === 'help') {
          // Split help into multiple messages to avoid Discord's 2000 character limit
          let helpMessage1 = '**🔧 Developer Commands (ZM_ClientExecutor)**\n\n';
          helpMessage1 += '**Basic Commands:**\n';
          helpMessage1 += '```\n';
          helpMessage1 += '!devplayersay <username> <message> - Make player say a message\n';
          helpMessage1 += '!devsetflag <username> <flagname> - Set flag on player\n';
          helpMessage1 += '!devremoveflag <username> <flagname> - Remove flag from player\n';
          helpMessage1 += '!devtoggleflag <username> <flagname> - Toggle ZM flag on player\n';
          helpMessage1 += '!devsethours <username> <hours> - Set hours survived for player\n';
          helpMessage1 += '!devsetzombiekills <username> <kills> - Set zombie kills for player\n';
          helpMessage1 += '!devenchant <username> <minDMG> <maxDMG> <enchant> <name> - Apply enchantment\n';
          helpMessage1 += '!devequipallow <username> <target> <itemType> <allow> - Set gear allow\n';
          helpMessage1 += '!devsetserverwideflag <flagname> <value> - Set server-wide flag\n';
          helpMessage1 += '!devsetglobalflag <flagname> <true|false> - Set global flag\n';
          helpMessage1 += '```';

          let helpMessage2 = '**📋 Quest Management:**\n';
          helpMessage2 += '```\n';
          helpMessage2 += '!devresetquest <username> <questID> - Reset quest for player\n';
          helpMessage2 += '!devlockquest <username> <questID> - Lock quest for player\n';
          helpMessage2 += '!devunlockquest <username> <questID> - Unlock quest for player\n';
          helpMessage2 += '```\n';
          helpMessage2 += '**✅ Task Management:**\n';
          helpMessage2 += '```\n';
          helpMessage2 += '!devunlocktask <username> <questID> <taskID> - Unlock task\n';
          helpMessage2 += '!devlocktask <username> <questID> <taskID> - Lock task\n';
          helpMessage2 += '!devcompletetask <username> <questID> <taskID> - Complete task\n';
          helpMessage2 += '!devresettask <username> <questID> <taskID> - Reset task\n';
          helpMessage2 += '```\n';
          helpMessage2 += '**💰 Player Points:**\n';
          helpMessage2 += '```\n';
          helpMessage2 += '!devaddplayerpoints <username> <points> - Add points\n';
          helpMessage2 += '!devtakeplayerpoints <username> <points> - Take points\n';
          helpMessage2 += '!devgetplayerpoints <username> - Get points\n';
          helpMessage2 += '!devdepositpoints <username> <amount> - Deposit points\n';
          helpMessage2 += '!devdepositraidpoints <username> <amount> - Deposit raid points\n';
          helpMessage2 += '!devwithdrawpoints <username> - Withdraw points\n';
          helpMessage2 += '!devwithdrawraidpoints <username> - Withdraw raid points\n';
          helpMessage2 += '```';

          let helpMessage3 = '**🕰️ Cron Job Management:**\n';
          helpMessage3 += '```\n';
          helpMessage3 += '!cronstatus - Check cron job status\n';
          helpMessage3 += '!testcron supply - Test supply run reset\n';
          helpMessage3 += '!testcron tank - Test global flags reset\n';
          helpMessage3 += '!testcron both - Test both cron jobs\n';
          helpMessage3 += '```\n';
          helpMessage3 += '**🏪 Auction System:**\n';
          helpMessage3 += '```\n';
          helpMessage3 += '!devauctionstatus - Check auction monitor status\n';
          helpMessage3 += '!devauctionscan - Trigger auction log scan\n';
          helpMessage3 += '!devauctionstart - Start auction monitoring\n';
          helpMessage3 += '!devauctionstop - Stop auction monitoring\n';
          helpMessage3 += '```\n';
          helpMessage3 += '**Note:** All commands require @admin or @developer role.';

          await message.channel.send(helpMessage1);
          await message.channel.send(helpMessage2);
          return message.channel.send(helpMessage3);
        }

        if (devCommand === 'playersay') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devplayersay <username> <message>`');
          }
          const username = args[0];
          const playerMessage = args.slice(1).join(' ');

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} playersayfunct "${playerMessage}"`);
            message.channel.send(`✅ Sent message command to player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'setflag') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devsetflag <username> <flagname>`');
          }
          const username = args[0];
          const flagName = args[1];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} setflagnpc ${flagName}`);
            message.channel.send(`✅ Set flag '${flagName}' on player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'removeflag') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devremoveflag <username> <flagname>`');
          }
          const username = args[0];
          const flagName = args[1];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} removeflagnpc ${flagName}`);
            message.channel.send(`✅ Removed flag '${flagName}' from player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'toggleflag') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devtoggleflag <username> <flagname>`');
          }
          const username = args[0];
          const flagName = args[1];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} togglezmflag ${flagName}`);
            message.channel.send(`✅ Toggled ZM flag '${flagName}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'sethours') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devsethours <username> <hours>`');
          }
          const username = args[0];
          const hours = args[1];

          if (isNaN(hours)) {
            return message.channel.send('❌ Hours must be a valid number.');
          }

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} sethourssurv ${hours}`);
            message.channel.send(`✅ Set hours survived to ${hours} for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'setzombiekills') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devsetzombiekills <username> <kills>`');
          }
          const username = args[0];
          const kills = args[1];

          if (isNaN(kills)) {
            return message.channel.send('❌ Kills must be a valid number.');
          }

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} setzombiekills ${kills}`);
            message.channel.send(`✅ Set zombie kills to ${kills} for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'enchant') {
          if (args.length < 5) {
            return message.channel.send('❌ Usage: `!devenchant <username> <minDMG> <maxDMG> <enchantment> <name>`');
          }
          const username = args[0];
          const minDMG = args[1];
          const maxDMG = args[2];
          const enchantment = args[3];
          const name = args[4];

          if (isNaN(minDMG) || isNaN(maxDMG) || isNaN(enchantment)) {
            return message.channel.send('❌ minDMG, maxDMG, and enchantment must be valid numbers.');
          }

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} debugapplyenchant ${minDMG} ${maxDMG} ${enchantment} ${name}`);
            message.channel.send(`✅ Applied enchantment ${enchantment} to weapon for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'equipallow') {
          if (args.length < 4) {
            return message.channel.send('❌ Usage: `!devequipallow <username> <targetUsername> <itemType> <allow>`');
          }
          const username = args[0];
          const targetUsername = args[1];
          const itemType = args[2];
          const allow = args[3];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} setrestrictedgearallow ${targetUsername} ${itemType} ${allow}`);
            message.channel.send(`✅ Set restricted gear allow for ${targetUsername} (itemType: ${itemType}, allow: ${allow})`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'setserverwideflag') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devsetserverwideflag <flagname> <value>`');
          }
          const flagName = args[0];
          const value = args[1];

          try {
            await this.sftpLogReader.updateServerFlag(flagName, value);
            message.channel.send(`✅ Set server-wide flag '${flagName}' to ${value} via SFTP`);
          } catch (error) {
            message.channel.send(`❌ Error updating server flag: ${error.message}`);
          }
        } else if (devCommand === 'setglobalflag') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devsetglobalflag <flagname> <true|false>`');
          }
          const flagName = args[0];
          const value = args[1];

          if (value !== 'true' && value !== 'false') {
            return message.channel.send('❌ Value must be either "true" or "false".');
          }

          try {
            const flagUpdates = {};
            flagUpdates[flagName] = value === 'true';
            await this.sftpLogReader.updateGlobalFlags(flagUpdates);
            message.channel.send(`✅ Set global flag '${flagName}' to ${value} via SFTP`);
          } catch (error) {
            message.channel.send(`❌ Error updating global flag: ${error.message}`);
          }
        } else if (devCommand === 'addplayerpoints') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devaddplayerpoints <username> <points>`');
          }
          const username = args[0];
          const points = args[1];

          if (isNaN(points) || parseInt(points) <= 0) {
            return message.channel.send('❌ Points must be a valid positive number.');
          }

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} addplayerpoints ${username} ${points}`);
            message.channel.send(`✅ Added ${points} points to player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'takeplayerpoints') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devtakeplayerpoints <username> <points>`');
          }
          const username = args[0];
          const points = args[1];

          if (isNaN(points) || parseInt(points) <= 0) {
            return message.channel.send('❌ Points must be a valid positive number.');
          }

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} takeplayerpoints ${username} ${points}`);
            message.channel.send(`✅ Removed ${points} points from player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'getplayerpoints') {
          if (args.length < 1) {
            return message.channel.send('❌ Usage: `!devgetplayerpoints <username>`');
          }
          const username = args[0];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} getplayerpoints ${username}`);
            message.channel.send(`✅ Sent get points command for player ${username}. Check server console/logs for result.`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'depositpoints') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devdepositpoints <username> <amount>`');
          }
          const username = args[0];
          const amount = args[1];

          if (isNaN(amount) || parseInt(amount) <= 0) {
            return message.channel.send('❌ Amount must be a valid positive number.');
          }

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} depositpoints ${username} ${amount}`);
            message.channel.send(`✅ Sent deposit ${amount} points command for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'depositraidpoints') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devdepositraidpoints <username> <amount>`');
          }
          const username = args[0];
          const amount = args[1];

          if (isNaN(amount) || parseInt(amount) <= 0) {
            return message.channel.send('❌ Amount must be a valid positive number.');
          }

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} depositraidpoints ${username} ${amount}`);
            message.channel.send(`✅ Sent deposit ${amount} raid points command for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'withdrawpoints') {
          if (args.length < 1) {
            return message.channel.send('❌ Usage: `!devwithdrawpoints <username>`');
          }
          const username = args[0];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} withdrawpoints ${username}`);
            message.channel.send(`✅ Sent withdraw points command for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'withdrawraidpoints') {
          if (args.length < 1) {
            return message.channel.send('❌ Usage: `!devwithdrawraidpoints <username>`');
          }
          const username = args[0];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} withdrawraidpoints ${username}`);
            message.channel.send(`✅ Sent withdraw raid points command for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'resetquest') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devresetquest <username> <questID>`');
          }
          const username = args[0];
          const questID = args[1];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} resetquest ${username} ${questID}`);
            message.channel.send(`✅ Reset quest '${questID}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'lockquest') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devlockquest <username> <questID>`');
          }
          const username = args[0];
          const questID = args[1];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} lockquest ${username} ${questID}`);
            message.channel.send(`✅ Locked quest '${questID}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'unlockquest') {
          if (args.length < 2) {
            return message.channel.send('❌ Usage: `!devunlockquest <username> <questID>`');
          }
          const username = args[0];
          const questID = args[1];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} unlockquest ${username} ${questID}`);
            message.channel.send(`✅ Unlocked quest '${questID}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'unlocktask') {
          if (args.length < 3) {
            return message.channel.send('❌ Usage: `!devunlocktask <username> <questID> <taskID>`');
          }
          const username = args[0];
          const questID = args[1];
          const taskID = args[2];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} unlocktask ${username} ${questID} ${taskID}`);
            message.channel.send(`✅ Unlocked task '${taskID}' in quest '${questID}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'locktask') {
          if (args.length < 3) {
            return message.channel.send('❌ Usage: `!devlocktask <username> <questID> <taskID>`');
          }
          const username = args[0];
          const questID = args[1];
          const taskID = args[2];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} locktask ${username} ${questID} ${taskID}`);
            message.channel.send(`✅ Locked task '${taskID}' in quest '${questID}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'completetask') {
          if (args.length < 3) {
            return message.channel.send('❌ Usage: `!devcompletetask <username> <questID> <taskID>`');
          }
          const username = args[0];
          const questID = args[1];
          const taskID = args[2];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} completetask ${username} ${questID} ${taskID}`);
            message.channel.send(`✅ Completed task '${taskID}' in quest '${questID}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'resettask') {
          if (args.length < 3) {
            return message.channel.send('❌ Usage: `!devresettask <username> <questID> <taskID>`');
          }
          const username = args[0];
          const questID = args[1];
          const taskID = args[2];

          try {
            await wrappedRconClient.send(`luacmd clientexe ${username} resettask ${username} ${questID} ${taskID}`);
            message.channel.send(`✅ Reset task '${taskID}' in quest '${questID}' for player ${username}`);
          } catch (error) {
            message.channel.send(`❌ Error executing command: ${error.message}`);
          }
        } else if (devCommand === 'auctionstatus') {
          // Check auction monitor status
          try {
            if (!this.auctionLogMonitor) {
              return message.channel.send('❌ Auction log monitor not available.');
            }

            const status = this.auctionLogMonitor.getStatus();
            let statusMessage = `**🏪 Auction Log Monitor Status**\n\n`;
            statusMessage += `**Status:** ${status.isRunning ? '🟢 RUNNING' : '🔴 STOPPED'}\n`;
            statusMessage += `**Current Position:** ${status.currentPosition} bytes\n`;
            statusMessage += `**Scan Interval:** ${status.scanInterval / 1000}s\n`;
            statusMessage += `**Interval Active:** ${status.intervalId ? '✅ Yes' : '❌ No'}\n`;

            message.channel.send(statusMessage);
          } catch (error) {
            message.channel.send(`❌ Error getting auction status: ${error.message}`);
          }
        } else if (devCommand === 'auctionscan') {
          // Manually trigger auction scan
          try {
            if (!this.auctionLogMonitor) {
              return message.channel.send('❌ Auction log monitor not available.');
            }

            message.channel.send('🔍 Triggering manual auction log scan...');
            await this.auctionLogMonitor.manualScan();
            message.channel.send('✅ Manual auction scan completed!');
          } catch (error) {
            message.channel.send(`❌ Error during manual scan: ${error.message}`);
          }
        } else if (devCommand === 'auctionstart') {
          // Start auction monitoring
          try {
            if (!this.auctionLogMonitor) {
              return message.channel.send('❌ Auction log monitor not available.');
            }

            await this.auctionLogMonitor.start();
            message.channel.send('✅ Auction log monitoring started successfully!');
          } catch (error) {
            message.channel.send(`❌ Failed to start auction monitoring: ${error.message}`);
          }
        } else if (devCommand === 'auctionstop') {
          // Stop auction monitoring
          try {
            if (!this.auctionLogMonitor) {
              return message.channel.send('❌ Auction log monitor not available.');
            }

            this.auctionLogMonitor.stop();
            message.channel.send('✅ Auction log monitoring stopped successfully!');
          } catch (error) {
            message.channel.send(`❌ Failed to stop auction monitoring: ${error.message}`);
          }
        } else {
          message.channel.send(`❌ Unknown developer command: ${devCommand}. Use \`!devhelp\` to see available commands.`);
        }
      } else if (command === 'isolationstatus') {
        message.channel.send('❌ The isolation status command is currently disabled.');
        // Check if user has admin or developer role
        // if (!isDeveloper && !isAdmin) {
        //   return message.channel.send('❌ You need the @developer or @admin role to check isolation zone status.');
        // }

        // const status = this.luaCommandManager.getStatus();

        // let statusMessage = `**🌙 Isolation Zone Horde Status**\n`;
        // statusMessage += `**Current Time (WIB):** ${status.currentTime}\n`;
        // statusMessage += `**Current Hour:** ${status.currentHour}:xx\n`;
        // statusMessage += `**Active Time Range:** ${status.isInActiveTimeRange ? '✅ YES (7 PM - 12 AM)' : '❌ NO (Outside 7 PM - 12 AM)'}\n`;
        // statusMessage += `**System Active:** ${status.isActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}\n`;
        // statusMessage += `**Next Check:** ${status.nextExecution}\n`;
        // statusMessage += `**Schedule:** ${status.schedule}`;

        // message.channel.send(statusMessage);
      } else if (command === 'testisolation') {
        message.channel.send('❌ The isolation test command is currently disabled.');
        // Check if user has admin or developer role
        // if (!isDeveloper && !isAdmin) {
        //   return message.channel.send('❌ You need the @developer or @admin role to test isolation zone commands.');
        // }

        // try {
        //   await message.channel.send('🧪 **Testing Isolation Zone Horde Check...**');

        //   await this.luaCommandManager.manualTriggerIsolationZone();

        //   await message.channel.send('✅ **Isolation Zone Horde Check Test Completed Successfully!**');
        // } catch (error) {
        //   await message.channel.send(`❌ **Isolation Zone Test Failed:** ${error.message}`);
        // }
      } else if (command === 'debugisolation') {
        message.channel.send('❌ The isolation debug command is currently disabled.');
        // Check if user has admin or developer role
        // if (!isDeveloper && !isAdmin) {
        //   return message.channel.send('❌ You need the @developer or @admin role to debug isolation zone.');
        // }

        // try {
        //   await message.channel.send('🔍 **Debugging Isolation Zone System...**');

        //   // Force run the check immediately
        //   await this.luaCommandManager.checkAndExecuteIsolationZone();

        //   const status = this.luaCommandManager.getStatus();

        //   let debugMessage = `**🔍 Debug Results:**\n`;
        //   debugMessage += `**Current Time:** ${status.currentTime}\n`;
        //   debugMessage += `**Current Hour:** ${status.currentHour}\n`;
        //   debugMessage += `**In Time Range:** ${status.isInActiveTimeRange}\n`;
        //   debugMessage += `**System Active:** ${status.isActive}\n`;
        //   debugMessage += `**RCON Available:** ${this.luaCommandManager.wrappedRconClient ? 'Yes' : 'No'}\n`;
        //   debugMessage += `**Discord Client:** ${this.luaCommandManager.discordClient ? 'Yes' : 'No'}`;

        //   await message.channel.send(debugMessage);
        // } catch (error) {
        //   await message.channel.send(`❌ **Debug Failed:** ${error.message}`);
        // }
      }
    });
  }

  setupCronJobs() {
    // Vehicle removal notification checker - runs every N minutes (configurable)
    const autoshopInterval = config.get('autoshop.checkIntervalMinutes') || 1;
    const cronExpression = `*/${autoshopInterval} * * * *`;
    const scheduledRestartWarningExpression = '59 3,11,17,20 * * *';
    const scheduledRestartExpression = '0 4,12,18,21 * * *';

    cron.schedule(
      cronExpression,
      async () => {
        const executionTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        try {
          await this.checkVehicleRemovalNotification();
          this.lastCronExecution.vehicleRemoval = new Date();
          this.lastCronExecution.vehicleRemovalSuccess = true;
        } catch (error) {
          this.lastCronExecution.vehicleRemoval = new Date();
          this.lastCronExecution.vehicleRemovalSuccess = false;
          logger.error(`[Cron] Vehicle removal check failed at ${executionTime}: ${error.message}`);
        }
      },
      {
        timezone: 'Asia/Jakarta', // WIB timezone
      }
    );

    console.log('📅 Cron jobs scheduled:');
    console.log(`   - Vehicle removal notification checker every ${autoshopInterval} minute(s)`);

    cron.schedule(
      scheduledRestartWarningExpression,
      async () => {
        const executionTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        const restartTime = new Date(Date.now() + 60 * 1000).toLocaleTimeString('en-US', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        try {
          await this.sendScheduledServerMessage(
            `SERVER NOTICE: Scheduled restart at ${restartTime} WIB (in 1 minute). Please safely logout to prevent rollback.`
          );
          this.lastCronExecution.scheduledRestartWarning = new Date();
          this.lastCronExecution.scheduledRestartWarningSuccess = true;
          logger.info(`[Cron] Scheduled restart warning sent at ${executionTime}`);
        } catch (error) {
          this.lastCronExecution.scheduledRestartWarning = new Date();
          this.lastCronExecution.scheduledRestartWarningSuccess = false;
          logger.error(`[Cron] Failed to send scheduled restart warning at ${executionTime}: ${error.message}`);
        }
      },
      {
        timezone: 'Asia/Jakarta',
      }
    );

    cron.schedule(
      scheduledRestartExpression,
      async () => {
        await this.runScheduledRestartCron();
      },
      {
        timezone: 'Asia/Jakarta',
      }
    );

    console.log('   - Scheduled restart warning at 03:59, 11:59, 17:59, 20:59 WIB');
    console.log('   - Scheduled server restart at 04:00, 12:00, 18:00, 21:00 WIB');

    // Handle button interactions and modal submissions for auction system
    this.client.on(Events.InteractionCreate, async (interaction) => {
      // Handle modal submissions
      if (interaction.isModalSubmit()) {
        const { customId, user, channel } = interaction;

        const auctionChannelId = config.get('discord.auctionChannelId');

        if (!auctionChannelId) {
          return interaction.reply({ content: '❌ Auction channel not configured. Please contact an administrator.', ephemeral: true });
        }

        if (channel.id !== auctionChannelId) {
          return interaction.reply({ content: '❌ Auction interactions can only be used in the auction channel.', ephemeral: true });
        }

        if (customId.startsWith('manualbid_modal_')) {
          try {
            const auctionId = customId.split('_')[2];
            const bidAmount = interaction.fields.getTextInputValue('bid_amount');

            await interaction.deferReply({ ephemeral: true });

            // Validate bid amount
            const bidAmountNum = parseFloat(bidAmount);
            if (isNaN(bidAmountNum) || bidAmountNum <= 0) {
              return interaction.editReply({ content: '❌ Invalid bid amount. Please enter a valid number.' });
            }

            const auction = await PlayerAuction.findByPk(auctionId);
            if (!auction) {
              return interaction.editReply({ content: 'Auction not found or no longer active.' });
            }
            if (auction.status !== 'active') {
              return interaction.editReply({ content: 'This auction is not active.' });
            }

            const bidderDiscordId = String(user.username);
            const bidder = await ZMUser.findOne({ where: { discordid: bidderDiscordId } });

            if (!bidder) {
              return interaction.editReply({
                content: '❌ **Whitelisted users only!**\n\nOnly whitelisted users can use auction features.'
              });
            }

            // Check if bidder is trying to bid on their own auction
            if (auction.sellerid === bidder.id) {
              return interaction.editReply({ content: 'You cannot bid on your own auction.' });
            }

            const currentBid = parseFloat(auction.lastbid || auction.itemprice) || 0;
            const minBid = currentBid + Math.max(1, currentBid * 0.01); // Minimum 1% increase or 1 point
            const buyoutPrice = auction.buyoutprice ? parseFloat(auction.buyoutprice) : null;

            // Validate bid amount
            if (bidAmountNum <= currentBid) {
              return interaction.editReply({ content: `❌ Bid must be higher than current bid of ${currentBid} points.` });
            }

            if (bidAmountNum < minBid) {
              return interaction.editReply({ content: `❌ Bid must be at least ${Math.ceil(minBid)} points.` });
            }

            // Check if bid reaches or exceeds buyout price
            const reachesBuyout = buyoutPrice && bidAmountNum >= buyoutPrice;
            const finalBid = reachesBuyout ? buyoutPrice : bidAmountNum;
            const finalStatus = reachesBuyout ? 'completed' : 'active';

            // Points refresh + validation (force dump, then read latest)
            const bidderNameForPoints = bidder.username1 || bidder.discordid || user.username;
            const dumpName = bidder.username1 || bidderNameForPoints;
            await this.dumpPlayerPoints(dumpName).catch(() => {});
            const pointsInfo = await this.refreshAndGetPoints(dumpName, 3, 900);
            if (!pointsInfo.exists) {
              return interaction.editReply({ content: '❌ Points data not found. Please sync your points first.' });
            }
            if (pointsInfo.points == null) {
              return interaction.editReply({ content: '❌ Your points file is unreadable. Please sync your points and try again.' });
            }
            if (pointsInfo.points < finalBid) {
              return interaction.editReply({ content: `❌ Insufficient points. You have ${pointsInfo.points} points but need at least ${finalBid} points for this bid.` });
            }

            // Update auction with new bid
            await auction.update({
              lastbid: finalBid,
              buyername: bidder.username1 || bidder.discordid,
              buyerid: bidder.id || null,
              buyerUsername: bidder.username1 || null,
              status: finalStatus
            });

            // If bid reaches buyout price, create win file immediately and delete auction message
            if (reachesBuyout) {
              // Delete the auction message since auction is completed
              await this.deleteAuctionMessage(auction, 'manual bid buyout');

              try {
                const canCreate = await this.markWinFileIfNeeded(auction.itemid, 'winner');
                if (canCreate) {
                  await this.sftpLogReader.createAuctionWinFile(bidder.username1, auction.toJSON());
                  console.log(`[AuctionManualBid] Created win file for ${bidder.username1} - Auction #${auction.itemid} (Manual bid reached buyout)`);
                } else {
                  console.log(`[AuctionManualBid] Win file already created, skipping duplicate for Auction #${auction.itemid}`);
                }
              } catch (fileError) {
                console.error('[AuctionManualBid] Error creating win file:', fileError);
              }
            }

            // Prepare response message
            let responseContent = `✅ Manual bid placed!\nAuction #${auction.itemid} • ${auction.itemname}\n`;

            if (reachesBuyout) {
              responseContent += `🎉 **AUCTION WON!**\nYour bid of ${bidAmountNum} points reached/exceeded the buyout price of ${buyoutPrice} points!\n**Winner:** ${bidder.username1 || user.username}\n\nThe auction is now complete and the item will be delivered!`;

              // Send public announcement for manual bid buyout
              try {
                await channel.send(`🏆 **MANUAL BID BUYOUT!**\n` +
                  `**${bidder.username1 || user.username}**'s manual bid of **${bidAmountNum} points** reached the buyout price!\n` +
                  `**Item:** ${auction.itemname} • **Final Price:** ${buyoutPrice} points\n` +
                  `**Auction ID:** #${auction.itemid}`);
              } catch (announcementError) {
                console.error('Failed to send manual bid buyout announcement:', announcementError);
              }
            } else {
              responseContent += `New current bid: ${finalBid} points\nBidder: ${bidder.username1 || user.username}`;
              if (buyoutPrice) {
                responseContent += `\n💡 **Tip:** Buyout available at ${buyoutPrice} points`;
              }
            }

            await interaction.editReply({ content: responseContent });

          } catch (error) {
            console.error('Error handling manual bid modal:', error);
            if (interaction.deferred) {
              await interaction.editReply({ content: '❌ An error occurred while processing your manual bid.' });
            } else {
              await interaction.reply({ content: '❌ An error occurred while processing your manual bid.', ephemeral: true });
            }
          }
        }
        return;
      }

      // Handle button interactions
      if (!interaction.isButton()) return;

      const { customId, user, channel } = interaction;

      const auctionChannelId = config.get('discord.auctionChannelId');

      if (!auctionChannelId) {
        return interaction.reply({ content: '❌ Auction channel not configured. Please contact an administrator.', ephemeral: true });
      }

      if (channel.id !== auctionChannelId) {
        return interaction.reply({ content: '❌ Auction interactions can only be used in the auction channel.', ephemeral: true });
      }

      try {
        if (customId.startsWith('bid_') || customId.startsWith('bidv2_')) {
          // Handle bid button clicks (both old 'bid_' and new 'bidv2_' formats)
          const auctionId = customId.split('_')[1];
          await interaction.deferReply({ ephemeral: true });

          const auction = await PlayerAuction.findByPk(auctionId);
          if (!auction) {
            return interaction.editReply({ content: 'Auction not found or no longer active.' });
          }
          if (auction.status !== 'active') {
            return interaction.editReply({ content: 'This auction is not active.' });
          }

          const bidderDiscordId = String(user.username);
          const bidder = await ZMUser.findOne({ where: { discordid: bidderDiscordId } });
          // console.log('Bidder info:', bidderDiscordId, bidder ? bidder.username1 : 'No user found');
          if (!bidder) {
            return interaction.editReply({
              content: '❌ **Whitelisted users only!**\n\nOnly whitelisted users can use auction features.\n\n**Already whitelisted?** Please open a support ticket if you\'re still unable to use this feature.'
            });
          }

          // Check if bidder is trying to bid on their own auction
          if (auction.sellerid === bidder.id) {
            return interaction.editReply({ content: 'You cannot bid on your own auction.' });
          }

          const startingPrice = parseFloat(auction.itemprice) || 0;
          const lastBid = parseFloat(auction.lastbid || auction.itemprice) || 0;
          const buyoutPrice = auction.buyoutprice ? parseFloat(auction.buyoutprice) : null;

          // Check if current bid has already reached buyout price
          if (buyoutPrice && lastBid >= buyoutPrice) {
            return interaction.editReply({
              content: `❌ **Auction at buyout price!**\n\nThis auction has already reached the buyout price of ${buyoutPrice} points.\nCurrent bid: ${lastBid} points\n\nUse the buyout button if you want to purchase instantly.`
            });
          }

          const increment = Math.max(0, startingPrice * 0.10);
          const newBid = lastBid + increment;

          // Check if new bid reaches or exceeds buyout price
          const reachesBuyout = buyoutPrice && newBid >= buyoutPrice;
          const finalBid = reachesBuyout ? buyoutPrice : newBid;
          const finalStatus = reachesBuyout ? 'completed' : 'active';

          // Points refresh + validation for auto bid
          const bidderNameForPoints = bidder.username1 || bidder.discordid || user.username;
          const dumpName = bidder.username1 || bidderNameForPoints;
          await this.dumpPlayerPoints(dumpName).catch(() => {});
          const pointsInfo = await this.refreshAndGetPoints(dumpName, 3, 900);
          if (!pointsInfo.exists) {
            return interaction.editReply({ content: '❌ Points data not found. Please sync your points first.' });
          }
          if (pointsInfo.points == null) {
            return interaction.editReply({ content: '❌ Your points file is unreadable. Please sync your points and try again.' });
          }
          // Need enough points to cover finalBid (potential buyout) or new bid
          if (pointsInfo.points < finalBid) {
            return interaction.editReply({ content: `❌ Insufficient points. You have ${pointsInfo.points} points but need at least ${finalBid} points for this bid.` });
          }

          // Update auction with new bid and buyer information including buyerUsername
          await auction.update({
            lastbid: finalBid,
            buyername: bidder.username1 || bidder.discordid,
            buyerid: bidder.id || null,
            buyerUsername: bidder.username1 || null,
            status: finalStatus
          });

          // If bid reaches buyout price, create win file immediately and delete auction message
          if (reachesBuyout) {
            // Delete the auction message since auction is completed
            await this.deleteAuctionMessage(auction, 'auto bid buyout');

            try {
              const canCreate = await this.markWinFileIfNeeded(auction.itemid, 'winner');
              if (canCreate) {
                await this.sftpLogReader.createAuctionWinFile(bidder.username1, auction.toJSON());
                console.log(`[AuctionAutoBuyout] Created win file for ${bidder.username1} - Auction #${auction.itemid} (Bid reached buyout)`);
              } else {
                console.log(`[AuctionAutoBuyout] Win file already created, skipping duplicate for Auction #${auction.itemid}`);
              }
            } catch (fileError) {
              console.error('[AuctionAutoBuyout] Error creating win file:', fileError);
            }
          }

          // Prepare response message
          let responseContent = `✅ Bid placed!\nAuction #${auction.itemid} • ${auction.itemname}\n`;

          if (reachesBuyout) {
            responseContent += `🎉 **AUCTION WON!**\nYour bid of ${newBid} points reached the buyout price of ${buyoutPrice} points!\n**Winner:** ${bidder.username1 || user.username}\n\nThe auction is now complete and the item will be delivered!`;

            // Send public announcement for auto-buyout
            try {
              await channel.send(`🏆 **AUTO-BUYOUT TRIGGERED!**\n` +
                `**${bidder.username1 || user.username}** has bought out **${auction.itemname}** for **${buyoutPrice} points**!\n` +
                `**Auction ID:** #${auction.itemid}`);
            } catch (announcementError) {
              console.error('Failed to send auto-buyout announcement:', announcementError);
            }
          } else {
            responseContent += `New current bid: ${finalBid} points (+${increment})\nBidder: ${bidder.username1 || user.username}`;
            if (buyoutPrice) {
              responseContent += `\n💡 **Tip:** Buyout available at ${buyoutPrice} points`;
            }
          }

          await interaction.editReply({ content: responseContent });

        } else if (customId.startsWith('buyout_')) {
          // Handle buyout button clicks
          const auctionId = customId.split('_')[1];
          await interaction.deferReply({ ephemeral: true });

          const auction = await PlayerAuction.findByPk(auctionId);
          if (!auction) {
            return interaction.editReply({ content: 'Auction not found or no longer active.' });
          }
          if (auction.status !== 'active') {
            return interaction.editReply({ content: 'This auction is not active.' });
          }
          if (!auction.buyoutprice || parseFloat(auction.buyoutprice) <= 0) {
            return interaction.editReply({ content: 'This auction does not have a buyout price.' });
          }

          const buyerDiscordId = String(user.username);
          const buyer = await ZMUser.findOne({ where: { discordid: buyerDiscordId } });
          if (!buyer) {
            return interaction.editReply({
              content: '❌ **Whitelisted users only!**\n\nOnly whitelisted users can use auction features.\n\n**Already whitelisted?** Please open a support ticket if you\'re still unable to use this feature.'
            });
          }

          // Check if buyer is trying to buyout their own auction
          if (auction.sellerid === buyer.id) {
            return interaction.editReply({ content: 'You cannot buy out your own auction.' });
          }

          const buyoutPrice = parseFloat(auction.buyoutprice);

          // Points refresh + validation for buyout
          const buyerNameForPoints = buyer.username1 || buyer.discordid || user.username;
          const dumpName = buyer.username1 || buyerNameForPoints;
          await this.dumpPlayerPoints(dumpName).catch(() => {});
          const buyoutPointsInfo = await this.refreshAndGetPoints(dumpName, 3, 900);
          if (!buyoutPointsInfo.exists) {
            return interaction.editReply({ content: '❌ Points data not found. Please sync your points first.' });
          }
          if (buyoutPointsInfo.points == null) {
            return interaction.editReply({ content: '❌ Your points file is unreadable. Please sync your points and try again.' });
          }
          if (buyoutPointsInfo.points < buyoutPrice) {
            return interaction.editReply({ content: `❌ Insufficient points. You have ${buyoutPointsInfo.points} points but need ${buyoutPrice} points for buyout.` });
          }

          // Mark auction as completed with buyout and delete the auction message
          await auction.update({
            status: 'completed',
            lastbid: buyoutPrice,
            buyername: buyer.username1 || buyer.discordid,
            buyerid: buyer.id || null,
            buyerUsername: buyer.username1 || null
          });

          // Delete the auction message since auction is completed
          await this.deleteAuctionMessage(auction, 'instant buyout');

          // Create auction win file for instant buyout
          try {
            const canCreate = await this.markWinFileIfNeeded(auction.itemid, 'winner');
            if (canCreate) {
              await this.sftpLogReader.createAuctionWinFile(buyer.username1, auction.toJSON());
              console.log(`[AuctionBuyout] Created win file for ${buyer.username1} - Auction #${auction.itemid} (Buyout)`);
            } else {
              console.log(`[AuctionBuyout] Win file already created, skipping duplicate for Auction #${auction.itemid}`);
            }
          } catch (fileError) {
            console.error('[AuctionBuyout] Error creating win file:', fileError);
          }

          await interaction.editReply({
            content: `🎉 **BUYOUT SUCCESSFUL!**\nAuction #${auction.itemid} • ${auction.itemname}\n**Buyout Price:** ${buyoutPrice} points\n**Winner:** ${buyer.username1 || user.username}\n\nThe item has been purchased instantly and the auction is now complete!`
          });

          // Send public announcement to the channel
          try {
            await channel.send(`🚀 **INSTANT BUYOUT!**\n` +
              `**${buyer.username1 || user.username}** has bought out **${auction.itemname}** for **${buyoutPrice} points**!\n` +
              `**Auction ID:** #${auction.itemid}`);
          } catch (announcementError) {
            console.error('Failed to send buyout announcement:', announcementError);
          }

        } else if (customId.startsWith('manualbid_')) {
          // Handle manual bid button clicks - show modal for bid input
          const auctionId = customId.split('_')[1];

          const auction = await PlayerAuction.findByPk(auctionId);
          if (!auction) {
            return interaction.reply({ content: 'Auction not found or no longer active.', ephemeral: true });
          }
          if (auction.status !== 'active') {
            return interaction.reply({ content: 'This auction is not active.', ephemeral: true });
          }

          const bidderDiscordId = String(user.username);
          const bidder = await ZMUser.findOne({ where: { discordid: bidderDiscordId } });

          if (!bidder) {
            return interaction.reply({
              content: '❌ **Whitelisted users only!**\n\nOnly whitelisted users can use auction features.\n\n**Already whitelisted?** Please open a support ticket if you\'re still unable to use this feature.',
              ephemeral: true
            });
          }

          // Check if bidder is trying to bid on their own auction
          if (auction.sellerid === bidder.id) {
            return interaction.reply({ content: 'You cannot bid on your own auction.', ephemeral: true });
          }

          const currentBid = parseFloat(auction.lastbid || auction.itemprice) || 0;
          const minBid = currentBid + Math.max(1, currentBid * 0.01); // Minimum 1% increase or 1 point
          const buyoutPrice = auction.buyoutprice ? parseFloat(auction.buyoutprice) : null;

          // Create modal for bid input
          const modal = new ModalBuilder()
            .setCustomId(`manualbid_modal_${auctionId}`)
            .setTitle(`Manual Bid - ${auction.itemname}`);

          const bidInput = new TextInputBuilder()
            .setCustomId('bid_amount')
            .setLabel(`Bid Amount (Current: ${currentBid} points)`)
            .setPlaceholder(`Enter bid amount (min: ${Math.ceil(minBid)} points)`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(10);

          const firstActionRow = new ActionRowBuilder().addComponents(bidInput);
          modal.addComponents(firstActionRow);

          await interaction.showModal(modal);

        } else if (customId === 'refresh_auctions') {
          // Handle refresh button
          await interaction.deferReply({ ephemeral: true });

          // Create a fake message object to reuse displayAuctionList method
          const fakeMessage = {
            channel: channel,
            author: user
          };

          await this.displayAuctionList(fakeMessage);
          await interaction.editReply({ content: '✅ Auction list refreshed!' });
        }
      } catch (error) {
        console.error('Error handling auction button interaction:', error);

        if (interaction.deferred) {
          await interaction.editReply({ content: '❌ An error occurred while processing your request.' });
        } else {
          await interaction.reply({ content: '❌ An error occurred while processing your request.', ephemeral: true });
        }
      }
    });
  }

  /**
   * Read current server points for a username from bridge file generated by ServerPointsCommands.bridge
   * File format:
   *   Time=...
   *   Username=<name>
   *   Points=<integer>
   * Directory expected relative to project root at ../Serverpoints/<username>.points.txt
   * @param {string} username
   * @returns {Promise<{exists:boolean, points:number|null, error?:string}>}
   */
  async getUserPoints(username) {
    const debug = [];
    const startTs = Date.now();
    try {
      if (!username) {
        debug.push('missing username param');
        logger.warn('[getUserPoints] Called without username');
        return { exists: false, points: null, error: 'missing-username', debug };
      }

      // Normalize username (strip surrounding quotes just in case)
      const normalizedUsername = username.replace(/^"|"$/g, '').trim();
      if (normalizedUsername !== username) {
        debug.push(`normalized from '${username}' to '${normalizedUsername}'`);
      }

      // 1. Attempt LOCAL filesystem lookup
      const rootDir = path.resolve(process.cwd(), '..');
      const pointsDirCandidates = [
        path.join(rootDir, 'Serverpoints'), // typical alongside Deposits folder
        path.join(process.cwd(), 'Serverpoints'),
        path.join(process.cwd(), '..', 'Serverpoints')
      ];
      let filePath = null;
      for (const dir of pointsDirCandidates) {
        const candidate = path.join(dir, `${normalizedUsername}.points.txt`);
        try {
          await fs.access(candidate);
          filePath = candidate;
          debug.push(`local-hit:${candidate}`);
          break;
        } catch {
          debug.push(`miss:${candidate}`);
        }
      }

      if (filePath) {
  if (ENABLE_POINTS_DEBUG) logger.debug(`[getUserPoints] Local file FOUND for ${normalizedUsername}: ${filePath}`);
        const content = await fs.readFile(filePath, 'utf8');
        const match = content.match(/Points=(\d+)/i);
        if (!match) {
          debug.push('format-miss: no Points= line');
          return { exists: true, points: null, error: 'format', debug };
        }
        const points = parseInt(match[1], 10);
        if (isNaN(points)) {
          debug.push('nan-after-parse');
          return { exists: true, points: null, error: 'nan', debug };
        }
        debug.push('success-local');
        return { exists: true, points, source: 'local', debug };
      }

      // 2. Remote SFTP fallback (server authoritative) - only if local not found
      debug.push('attempt-remote');
      const remoteDir = '/home/pzserver/Zomboid/Lua/Serverpoints';
      const remoteFilePath = `${remoteDir}/${normalizedUsername}.points.txt`;
      try {
        await this.sftpLogReader.connect();
        let remoteContent;
        try {
          remoteContent = await this.sftpLogReader.sftp.get(remoteFilePath);
        } catch (remoteErr) {
          debug.push('remote-miss:' + remoteErr.message);
          if (ENABLE_POINTS_DEBUG) logger.debug(`[getUserPoints] Remote file NOT found for ${normalizedUsername}: ${remoteFilePath}`);
          return { exists: false, points: null, error: 'not-found', debug };
        }

        const contentStr = remoteContent.toString('utf8');
        const match = contentStr.match(/Points=(\d+)/i);
        if (!match) {
          debug.push('remote-format-miss');
          return { exists: true, points: null, error: 'format', source: 'remote', debug };
        }
        const points = parseInt(match[1], 10);
        if (isNaN(points)) {
          debug.push('remote-nan');
          return { exists: true, points: null, error: 'nan', source: 'remote', debug };
        }
        debug.push('success-remote');
        if (ENABLE_POINTS_DEBUG) logger.debug(`[getUserPoints] Remote points read for ${normalizedUsername}: ${points}`);
        return { exists: true, points, source: 'remote', debug };
      } finally {
        try { await this.sftpLogReader.disconnect(); } catch {}
      }
    } catch (err) {
      debug.push('exception:' + err.message);
      logger.error(`[getUserPoints] Exception for ${username}: ${err.message}`);
      return { exists: false, points: null, error: 'exception:' + err.message, debug };
    } finally {
      const duration = Date.now() - startTs;
      if (ENABLE_POINTS_DEBUG) logger.debug(`[getUserPoints] Finished for ${username} in ${duration}ms`);
    }
  }

  async sendCronNotification(jobType, success, executionTime, errorMessage = null) {
    try {
      // Try to find a logs or monitoring channel
      const logChannels = ['logs', 'monitoring', 'admin-logs', 'bot-logs'];
      let logChannel = null;

      for (const channelName of logChannels) {
        logChannel = this.client.channels.cache.find((channel) => channel.name.toLowerCase().includes(channelName) && channel.type === 0);
        if (logChannel) break;
      }

      if (logChannel) {
        const statusEmoji = success ? '✅' : '❌';
        const statusText = success ? 'SUCCESS' : 'FAILED';

        let message = `${statusEmoji} **Cron Job ${statusText}**\n`;
        message += `**Job Type:** ${jobType}\n`;
        message += `**Execution Time:** ${executionTime}\n`;

        if (!success && errorMessage) {
          message += `**Error:** ${errorMessage}\n`;
        }

        await logChannel.send(message);
      }
    } catch (notificationError) {
      console.error('Failed to send cron notification to Discord:', notificationError.message);
    }
  }

  /**
   * Check for vehicle removal notification file via SFTP
   * If found, parse and send Discord notification, then delete the file
   */
  async checkVehicleRemovalNotification() {
    const remoteFilePath = config.get('autoshop.remoteFilePath') || '/home/pzserver/Zomboid/Lua/ZM_Autoshop_VehicleRemoval.json';

    try {
      await this.sftpLogReader.connect();

      let fileContent;
      try {
        fileContent = await this.sftpLogReader.sftp.get(remoteFilePath);
      } catch (err) {
        // File doesn't exist, this is normal - just return silently
        if (err.message.includes('No such file')) {
          return;
        }
        throw err;
      }

      if (!fileContent || fileContent.length === 0) {
        logger.warn('[VehicleRemoval] File exists but is empty');
        return;
      }

      // Parse JSON content
      const vehicleData = JSON.parse(fileContent.toString('utf8'));

      // Send Discord notification
      await this.sendVehicleRemovalNotification(vehicleData);

      // Delete the file after successful notification
      await this.sftpLogReader.sftp.delete(remoteFilePath);
      logger.info(`[VehicleRemoval] Processed and deleted notification file for ${vehicleData.player}`);

    } catch (error) {
      logger.error(`[VehicleRemoval] Error checking notification: ${error.message}`);
      throw error;
    } finally {
      try {
        await this.sftpLogReader.disconnect();
      } catch (disconnectErr) {
        logger.warn(`[VehicleRemoval] Error disconnecting SFTP: ${disconnectErr.message}`);
      }
    }
  }

  /**
   * Send vehicle removal notification to Discord
   * @param {Object} vehicleData - Vehicle removal data from JSON file
   */
  async sendVehicleRemovalNotification(vehicleData) {
    try {
      const channelId = config.get('discord.vehicleRemovalChannelId');
      if (!channelId) {
        logger.error('[VehicleRemoval] Vehicle removal channel ID not configured');
        return;
      }

      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        logger.error(`[VehicleRemoval] Channel ${channelId} not found`);
        return;
      }

      // Format timestamp
      const timestamp = new Date(vehicleData.timestamp * 1000);
      const timeStr = timestamp.toLocaleString('en-US', {
        timeZone: 'Asia/Jakarta',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });

      // Create simple, clean message
      const message =
        `🚗 **Vehicle Sold**\n\n` +
        `**${vehicleData.player}** sold ***${vehicleData.vehicle}***\n` +
        `**Points:** ${vehicleData.points.toLocaleString()} *(${vehicleData.condition}% condition)*\n` +
        `*Time: ${timeStr} WIB*`;

      await channel.send(message);
      logger.info(`[VehicleRemoval] Sent notification for ${vehicleData.player}'s ${vehicleData.vehicle}`);

    } catch (error) {
      logger.error(`[VehicleRemoval] Error sending notification: ${error.message}`);
      throw error;
    }
  }

  async handleAIChannelMessage(message) {
    try {
      // Import AI assistant dinamically untuk avoid circular import
      const { default: aiAssistant } = await import('../ai/assistant.js');

      // Skip jika pesan terlalu pendek atau hanya emoji/mention
      const messageContent = message.content.trim();
      if (messageContent.length < 3 ||
          /^[!@#$%^&*()_+=\[\]{}|;':",./<>?`~\s]*$/.test(messageContent) ||
          /^<[@#&!][^>]*>+\s*$/.test(messageContent)) {
        return;
      }

      // Check cooldown untuk AI responses (per user, per 30 detik)
      const aiCooldownKey = `ai:${message.author.id}`;
      const aiCooldownTime = 30 * 1000; // 30 seconds
      const now = Date.now();

      if (this.commandCooldowns.has(aiCooldownKey)) {
        const lastUsed = this.commandCooldowns.get(aiCooldownKey);
        if (now - lastUsed < aiCooldownTime) {
          // Skip response jika masih dalam cooldown
          return;
        }
      }

      this.commandCooldowns.set(aiCooldownKey, now);

      // Show typing indicator
      await message.channel.sendTyping();

      // Generate AI response
      const response = await aiAssistant.generateResponse(messageContent, {
        userId: message.author.id,
        userName: message.author.username,
        channelId: message.channel.id,
        isAutoResponse: true
      });

      // Send response(s) - can be single string or array of strings
      if (Array.isArray(response)) {
        for (let i = 0; i < response.length; i++) {
          await message.channel.send(response[i]);
          // Add small delay between multiple messages
          if (i < response.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } else {
        await message.channel.send(response);
      }

    } catch (error) {
      console.error('Error in AI channel auto-response:', error);
      // Don't send error message untuk auto-response, just log it
    }
  }

  /**
   * Ask the game to dump latest points for a username via RCON
   * @param {string} username
   */
  async dumpPlayerPoints(username) {
    try {
      if (!username) return false;
      const safeName = username.replace(/^"|"$/g, '').trim();
      await this.wrappedRconClient?.send(`luacmd clientexe ${safeName} dumpPlayerPoints`);
      return true;
    } catch (e) {
      // Non-fatal for validation; we will still try to read existing file
      return false;
    }
  }

  /**
   * Force a dump then retry read a few times to get fresh points
   * @param {string} username
   * @param {number} retries
   * @param {number} delayMs
   */
  async refreshAndGetPoints(username, retries = 3, delayMs = 800) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let last = { exists: false, points: null };
    for (let i = 0; i < Math.max(1, retries); i++) {
      last = await this.getUserPoints(username);
      if (last.exists && last.points != null) return last;
      await wait(delayMs);
    }
    return last;
  }

  /**
   * Atomically mark win-file flag to avoid duplicates
   * Returns true if this call set the flag (caller should create file), false if already set
   */
  async markWinFileIfNeeded(auctionItemId, type) {
    const field = type === 'winner' ? 'winnerWinFileCreated' : 'sellerReturnWinFileCreated';
    const [affected] = await PlayerAuction.update(
      { [field]: true, winFileCreatedAt: new Date() },
      { where: { itemid: auctionItemId, [field]: false } }
    );
    return affected > 0;
  }

  /**
   * Display auction list with bid buttons
   * @param {Message} message - Discord message object
   */
  async displayAuctionList(message) {
    try {
      // Fetch active auctions from database
      const activeAuctions = await PlayerAuction.findAll({
        where: { status: 'active' },
        include: [{
          model: ZMUser,
          as: 'seller',
          attributes: ['username1', 'steamid']
        }],
        order: [['createdAt', 'DESC']],
        limit: 10 // Show latest 10 auctions
      });

      if (activeAuctions.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('🏪 Current Auctions')
          .setDescription('No active auctions at the moment.')
          .setColor(0x3498db)
          .setTimestamp();

        return message.channel.send({ embeds: [embed] });
      }

      // Create embed for auction list
      const embed = new EmbedBuilder()
        .setTitle('🏪 Current Active Auctions')
        .setDescription(`Found **${activeAuctions.length}** active auction(s)`)
        .setColor(0xe74c3c)
        .setTimestamp()
        .setFooter({ text: 'Click "Bid" to place a bid or "Buyout" to purchase instantly' });

      // Add auction fields
      for (let i = 0; i < activeAuctions.length && i < 5; i++) {
        const auction = activeAuctions[i];
        const seller = auction.seller || {};

        const buyoutInfo = auction.buyoutprice && parseFloat(auction.buyoutprice) > 0
          ? `**Buyout:** ${auction.buyoutprice} points`
          : '**Buyout:** Not available';

        const fieldValue = [
          `**Seller:** ${seller.username1 || 'Unknown'}`,
          `**Current Bid:** ${auction.lastbid || auction.itemprice} points`,
          buyoutInfo,
          `**Description:** ${auction.itemdesc || 'No description'}`,
          `**ID:** ${auction.itemid}`
        ].join('\n');

        embed.addFields({
          name: `${i + 1}. ${auction.itemname}`,
          value: fieldValue,
          inline: true
        });
      }

      // Create bid and buyout buttons
      const rows = [];
      const maxButtonsPerRow = 5;

      // Create bid buttons row
      const bidRow = new ActionRowBuilder();
      for (let i = 0; i < Math.min(activeAuctions.length, maxButtonsPerRow); i++) {
        const auction = activeAuctions[i];
        bidRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`bidv2_${auction.itemid}`)
            .setLabel(`Bid #${i + 1}`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💰')
        );
      }
      if (bidRow.components.length > 0) {
        rows.push(bidRow);
      }

      // Create buyout buttons row for items that have buyout prices
      const buyoutRow = new ActionRowBuilder();
      let buyoutCount = 0;
      for (let i = 0; i < Math.min(activeAuctions.length, maxButtonsPerRow); i++) {
        const auction = activeAuctions[i];
        if (auction.buyoutprice && parseFloat(auction.buyoutprice) > 0) {
          buyoutRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`buyout_${auction.itemid}`)
              .setLabel(`Buyout #${i + 1}`)
              .setStyle(ButtonStyle.Success)
              .setEmoji('⚡')
          );
          buyoutCount++;
        }
      }
      if (buyoutRow.components.length > 0) {
        rows.push(buyoutRow);
      }

      // Add refresh button
      if (rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        if (lastRow.components.length < 5) {
          lastRow.addComponents(
            new ButtonBuilder()
              .setCustomId('refresh_auctions')
              .setLabel('Refresh')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('🔄')
          );
        } else {
          // Create new row for refresh button if last row is full
          const refreshRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('refresh_auctions')
                .setLabel('Refresh')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔄')
            );
          rows.push(refreshRow);
        }
      }

      await message.channel.send({
        embeds: [embed],
        components: rows
      });

    } catch (error) {
      console.error('Error in displayAuctionList:', error);
      throw error;
    }
  }

  /**
   * Delete Discord message for an auction
   * @param {Object} auction - Auction object with discordMessageId
   * @param {string} reason - Reason for deletion (e.g., "expired", "completed")
   */
  async deleteAuctionMessage(auction, reason = 'completed') {
    try {
      if (!auction.discordMessageId) {
        return; // No message ID stored
      }

      const auctionChannelId = config.get('discord.auctionChannelId');
      if (!auctionChannelId) {
        console.warn('[MessageDelete] Auction channel not configured');
        return;
      }

      const channel = this.client.channels.cache.get(auctionChannelId);
      if (!channel) {
        console.warn(`[MessageDelete] Auction channel not found: ${auctionChannelId}`);
        return;
      }

      try {
        const message = await channel.messages.fetch(auction.discordMessageId);
        if (message) {
          await message.delete();
          console.log(`[MessageDelete] Deleted Discord message ${auction.discordMessageId} for auction #${auction.itemid} (${reason})`);
        }
      } catch (fetchError) {
        if (fetchError.code === 10008) {
          // Message not found (already deleted)
          console.log(`[MessageDelete] Message ${auction.discordMessageId} already deleted for auction #${auction.itemid}`);
        } else {
          console.warn(`[MessageDelete] Failed to fetch/delete message ${auction.discordMessageId}:`, fetchError.message);
        }
      }
    } catch (error) {
      console.error(`[MessageDelete] Error deleting auction message:`, error);
    }
  }

  /**
   * Check for expired auctions and process winners
   * This should be called periodically or triggered by auction expiry events
   */
  async processExpiredAuctions() {
    try {
      const expiryTime = new Date();
      expiryTime.setHours(expiryTime.getHours() - 24); // 24 hours ago

      // A) Auctions that timed-out by age (still marked active)
      const timedOut = await PlayerAuction.findAll({
        where: {
          status: 'active',
          createdAt: { [Op.lt]: expiryTime }
        },
        include: [{ model: ZMUser, as: 'seller', attributes: ['username1', 'steamid'] }]
      });

      // B) Auctions already marked as expired in DB (ensure cleanup + win file)
      const markedExpired = await PlayerAuction.findAll({
        where: { status: 'expired' },
        include: [{ model: ZMUser, as: 'seller', attributes: ['username1', 'steamid'] }]
      });

      // Merge without duplicates
      const byId = new Map();
      for (const a of timedOut) byId.set(a.id, a);
      for (const a of markedExpired) byId.set(a.id, a);
      const toProcess = Array.from(byId.values());

      for (const auction of toProcess) {
        // Always try to remove the Discord message
        await this.deleteAuctionMessage(auction, 'expired');

        const hasWinner = !!(auction.buyerid && auction.buyerUsername && auction.lastbid);
        if (hasWinner) {
          // Ensure completed status
          if (auction.status !== 'completed') {
            await auction.update({ status: 'completed' });
          }
          // Create win file for winner
          try {
            const canCreate = await this.markWinFileIfNeeded(auction.itemid, 'winner');
            if (canCreate) {
              await this.sftpLogReader.createAuctionWinFile(auction.buyerUsername, auction.toJSON());
              await auction.update({ winnerWinFileCreated: true, winFileCreatedAt: new Date() });
              console.log(`[AuctionExpired] Created win file for ${auction.buyerUsername} - Auction #${auction.itemid} (Expired with winner)`);
            } else {
              console.log(`[AuctionExpired] Winner win file already created, skipping duplicate for Auction #${auction.itemid}`);
            }

            const auctionChannelId = config.get('discord.auctionChannelId');
            if (auctionChannelId) {
              const channel = this.client.channels.cache.get(auctionChannelId);
              if (channel) {
                const winnerMessage = await channel.send(`🕒 **Auction Expired - Winner Announced!**\n` +
                  `**Item:** ${auction.itemname}\n` +
                  `**Winner:** ${auction.buyerUsername}\n` +
                  `**Final Bid:** ${auction.lastbid} points\n` +
                  `**Auction ID:** #${auction.itemid}`);
                setTimeout(async () => {
                  try { await winnerMessage.delete(); } catch {}
                }, 10 * 60 * 1000);
              }
            }
          } catch (fileError) {
            console.error('[AuctionExpired] Error creating win file for winner:', fileError);
          }
        } else {
          // No bidders: keep/ensure expired and return to seller
          if (auction.status !== 'expired') {
            await auction.update({ status: 'expired' });
          }

          try {
            const seller = auction.seller || await ZMUser.findByPk(auction.sellerid);
            const sellerUsername = seller?.username1 || auction.sellername || 'Unknown';
            const canCreate = await this.markWinFileIfNeeded(auction.itemid, 'seller');
            if (canCreate) {
              await this.sftpLogReader.createAuctionWinFile(sellerUsername, auction.toJSON());
              console.log(`[AuctionExpired] Created win file to return item to seller ${sellerUsername} - Auction #${auction.itemid} (Expired with no bidders)`);
            } else {
              console.log(`[AuctionExpired] Seller-return file already created, skipping duplicate for Auction #${auction.itemid}`);
            }

            const auctionChannelId = config.get('discord.auctionChannelId');
            if (auctionChannelId) {
              const channel = this.client.channels.cache.get(auctionChannelId);
              if (channel) {
                const returnMessage = await channel.send(`🕒 **Auction Expired - Item Returned!**\n` +
                  `**Item:** ${auction.itemname}\n` +
                  `**Returned to Seller:** ${sellerUsername}\n` +
                  `**Reason:** No bidders\n` +
                  `**Auction ID:** #${auction.itemid}`);
                setTimeout(async () => {
                  try { await returnMessage.delete(); } catch {}
                }, 10 * 60 * 1000);
              }
            }
          } catch (fileError) {
            console.error('[AuctionExpired] Error creating win file for seller return:', fileError);
          }
        }
      }

      if (toProcess.length > 0) {
        console.log(`[AuctionExpired] Processed ${toProcess.length} expired auctions (age-based + status-expired)`);
      }
    } catch (error) {
      console.error('[AuctionExpired] Error processing expired auctions:', error);
    }
  }

  // Make sure to clean up when the bot is shutting down
  cleanup() {
    if (this.rconHeartbeatInterval) {
      clearInterval(this.rconHeartbeatInterval);
      this.rconHeartbeatInterval = null;
    }

    // Cleanup lua command manager
    this.luaCommandManager.cleanup();
  }
}
