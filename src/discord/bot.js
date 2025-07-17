import { Client, GatewayIntentBits, Events } from 'discord.js';
import { BattleMetricsAPI } from '../utils/battlemetrics.js';
import config from '../config/config.js';
import { SftpLogReader } from '../utils/sftpLogReader.js';
import { Client as SSHClient } from 'ssh2';
import dotenv from 'dotenv';
import * as zmUsersDb from '../utils/zmUsersDb.js';
import cron from 'node-cron';
dotenv.config();

export class DiscordBot {
  constructor(token) {
    this.token = token || config.discord.token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    this.battlemetrics = new BattleMetricsAPI(
      config.battlemetrics.apiKey,
      config.battlemetrics.serverId
    );
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
    this.heartbeatIntervalTime = 5 * 60 * 1000; // 5 minutes
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
      tankFlagsSuccess: false
    };
  }

  async login() {
    return this.client.login(this.token);
  }

  setupRconConnection(rconClient) {
    this.rconClient = rconClient;

    // Setup RCON heartbeat to keep connection alive
    this.startRconHeartbeat();

    // Return the wrapped rcon client with auto-reconnect
    return {
      send: async (command) => {
        try {
          return await this.sendRconCommand(command);
        } catch (error) {
          console.error(`RCON command failed: ${error.message}`);

          // Try to reconnect and retry the command once
          if (error.message.includes('WebSocket') || error.message.includes('ECONNRESET') ||
              error.message.includes('not connected') || error.message.toLowerCase().includes('timeout')) {
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
      }
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
        console.log('Sending RCON heartbeat... );');
        await this.sendRconCommand('players');
        console.log('RCON heartbeat successful');
      } catch (error) {
        console.error(`RCON heartbeat failed: ${error.message}`);
        this.reconnectRcon().catch(e => console.error(`Failed to reconnect: ${e.message}`));
      }
    }, this.heartbeatIntervalTime);

    console.log(`RCON heartbeat started, interval: ${this.heartbeatIntervalTime / 1000} seconds - Current server time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })}`);
  }

  async sendRconCommand(command) {
    if (!this.rconClient) {
      throw new Error('RCON client not initialized');
    }

    return this.rconClient.send(command);
  }

  async reconnectRcon() {
    if (this.isReconnecting) {
      console.log('Reconnection already in progress, skipping...');
      return;
    }

    this.isReconnecting = true;

    try {
      console.log('Attempting to reconnect to RCON server...');

      // This assumes your RCON client has a connect or reconnect method
      // Adjust this based on your actual RCON client implementation
      if (typeof this.rconClient.connect === 'function') {
        await this.rconClient.connect();
      } else if (typeof this.rconClient.reconnect === 'function') {
        await this.rconClient.reconnect();
      } else {
        // If no explicit reconnect method, you might need to recreate the client
        // This would require more context on how your RCON client is created
        throw new Error('No reconnect method available on RCON client');
      }

      console.log('Successfully reconnected to RCON server');
    } finally {
      this.isReconnecting = false;
    }
  }

  setupEventListeners(rconClient) {
    // Set up RCON with auto-reconnect wrapper
    const wrappedRconClient = this.setupRconConnection(rconClient);

    // Store wrapped RCON client for cron jobs
    this.wrappedRconClient = wrappedRconClient;

    // Setup cron jobs
    this.setupCronJobs();

    this.client.on(Events.MessageCreate, async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      const prefix = config.discord.prefix;

      // Check if message starts with prefix
      if (!message.content.startsWith(prefix)) return;

      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();

      // --- Development Mode Check ---
      const isDeveloper = message.member && message.member.roles.cache.some(role => role.name.toLowerCase() === 'developer');
      const isAdmin = message.member && message.member.roles.cache.some(role => role.name.toLowerCase() === 'admin');

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
        return message.channel.send(`🔧 Development mode is now **${this.devMode ? 'ON' : 'OFF'}**. ${this.devMode ? 'Only developers and admins can use commands.' : 'All users can use commands.'}`);
      }

      // --- Cooldown check ---
      if (!isAdmin) { // Admins are immune to cooldown
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

          // Check cooldown period
          if (this.lastRestartTime) {
            const timeSinceLastRestart = Date.now() - this.lastRestartTime;
            if (timeSinceLastRestart < this.restartCooldown) {
              const remainingTime = this.restartCooldown - timeSinceLastRestart;
              const remainingMinutes = Math.ceil(remainingTime / (60 * 1000));
              return message.channel.send(
                `Server restart is on cooldown. Please wait ${remainingMinutes} more minutes before restarting again.`
              );
            }
          }

          // If admin, skip confirmation and restart immediately
          if (isAdmin) {
            await message.channel.send(`Server restart initiated by ${message.author.username} (Admin)...`);
            try {
              // First warning via RCON
              await wrappedRconClient.send('servermsg "SERVER RESTART: Restart initiated by Admin. Server will restart in 3 minutes."');
              // Wait 2 minutes
              setTimeout(async () => {
                // Second warning via RCON
                await wrappedRconClient.send('servermsg "SERVER RESTART IMMINENT: Saving world and restarting in 1 minute. Please finish what you\'re doing!"');
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
                    conn.on('ready', () => {
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
                    }).on('error', reject).connect(sshConfig);
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

            const filter = m => ['confirm', 'cancel'].includes(m.content.toLowerCase());
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
                    await wrappedRconClient.send('servermsg "SERVER RESTART IMMINENT: Saving world and restarting in 1 minute. Please finish what you\'re doing!"');
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
                        conn.on('ready', () => {
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
                        }).on('error', reject).connect(sshConfig);
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
        try {
          const statusMsg = await message.channel.send('Checking for mod updates, please wait while im reading the log...');
          await wrappedRconClient.send('checkModsNeedUpdate');
          await wrappedRconClient.send('checkModsNeedUpdate');
          await wrappedRconClient.send('checkModsNeedUpdate');
          await wrappedRconClient.send('checkModsNeedUpdate');
          await wrappedRconClient.send('checkModsNeedUpdate');
          await wrappedRconClient.send('checkModsNeedUpdate');
          await wrappedRconClient.send('checkModsNeedUpdate');
          await wrappedRconClient.send('checkModsNeedUpdate');

          const result = await this.sftpLogReader.checkForModUpdates();
          // console.log(JSON.stringify(result, null, 2));

          if (result && result.success) {
            await statusMsg.edit(`Mod update check result: **${result.message}**`);
            if (result?.needsUpdate) {
              await message.channel.send('Mod update detected! Restarting server...');
              try {
                // First warning via RCON
                await wrappedRconClient.send('servermsg "SERVER RESTART: Restart initiated due to mod update. Server will restart in 3 minutes."');
                await message.channel.send('In-game notification sent. Waiting 2 minutes before next warning...');

                // Wait 2 minutes
                await new Promise(resolve => setTimeout(resolve, 120000));

                // Second warning via RCON
                await wrappedRconClient.send('servermsg "SERVER RESTART IMMINENT: Saving world and restarting in 1 minute. Please finish what you\'re doing!"');
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
                    conn.on('ready', () => {
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
                    }).on('error', reject).connect(sshConfig);
                  });
                  await message.channel.send('Server restart command sent via SSH. Server will restart now.');
                  this.lastRestartTime = Date.now();
                }, 60000); // 1 minute
              } catch (restartError) {
                await message.channel.send(`Error during restart: ${restartError.message}`);
                console.error('Restart error:', restartError);
              }
            }
          } else {
            await statusMsg.edit(`Mod update check result: **${result.message || 'Unknown error'}**`);
          }
        } catch (err) {
          message.channel.send(`Error checking mod updates: ${err.message}`);
          console.error('Error in !checkupdate:', err);
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
      } else if (command === 'adduser') {
        // Check if user has admin role
        if (!message.member.roles.cache.some(role => role.name.toLowerCase() === 'admin')) {
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
              extradata: `Added by ${message.author.tag} on ${new Date().toISOString()}`
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
        if (!message.member.roles.cache.some(role => role.name.toLowerCase() === 'admin')) {
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
          return message.channel.send('❌ You need the @developer or @admin role to check cron job status.');
        }

        const now = new Date();
        const wibTime = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });

        let statusMessage = `**🕰️ Cron Job Status Report**\n`;
        statusMessage += `**Current Time (WIB):** ${wibTime}\n\n`;

        // Supply Run Status
        if (this.lastCronExecution.supplyRun) {
          const lastSupplyRun = this.lastCronExecution.supplyRun.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
          const supplyStatus = this.lastCronExecution.supplyRunSuccess ? '✅ SUCCESS' : '❌ FAILED';
          statusMessage += `**Supply Run Reset:**\n`;
          statusMessage += `└ Last Execution: ${lastSupplyRun}\n`;
          statusMessage += `└ Status: ${supplyStatus}\n\n`;
        } else {
          statusMessage += `**Supply Run Reset:**\n`;
          statusMessage += `└ Status: ⏳ Not executed yet today\n\n`;
        }

        // Tank Flags Status
        if (this.lastCronExecution.tankFlags) {
          const lastTankFlags = this.lastCronExecution.tankFlags.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
          const tankStatus = this.lastCronExecution.tankFlagsSuccess ? '✅ SUCCESS' : '❌ FAILED';
          statusMessage += `**Tank Flags Reset:**\n`;
          statusMessage += `└ Last Execution: ${lastTankFlags}\n`;
          statusMessage += `└ Status: ${tankStatus}\n\n`;
        } else {
          statusMessage += `**Tank Flags Reset:**\n`;
          statusMessage += `└ Status: ⏳ Not executed yet today\n\n`;
        }

        statusMessage += `**Next Scheduled Execution:** Supply run at 12:01 PM WIB, Tank flags at 12:02 PM WIB\n`;
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
              supplyRunCompleted: 0
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
            await message.channel.send('🧪 **Testing Tank Flags Reset...**');

            const tankFlagUpdates = {
              daily_tankWB02_flag: false,
              daily_tankWB01_flag: false
            };

            await this.sftpLogReader.updateGlobalFlags(tankFlagUpdates);

            this.lastCronExecution.tankFlags = new Date();
            this.lastCronExecution.tankFlagsSuccess = true;

            await message.channel.send('✅ **Tank Flags Reset Test Completed Successfully!**');

            // Send server message
            try {
              await this.wrappedRconClient.send('servermsg "Daily tank events have been reset! (Manual Test) Tank spawns are now available again."');
            } catch (msgError) {
              console.warn('Could not send tank reset server message:', msgError.message);
            }

          } catch (error) {
            this.lastCronExecution.tankFlags = new Date();
            this.lastCronExecution.tankFlagsSuccess = false;
            await message.channel.send(`❌ **Tank Flags Reset Test Failed:** ${error.message}`);
          }
        }

        if (jobType !== 'supply' && jobType !== 'tank' && jobType !== 'both') {
          return message.channel.send('❌ Invalid job type. Use: `!testcron <supply|tank|both>`');
        }
      } else if (command === 'help') {
        const prefix = config.discord.prefix;

        let helpMessage = '**🤖 Zona Merah Project Z - Command List 🤖**\n\n';

        // General commands (no role requirements)
        helpMessage += '**General Commands:**\n';
        helpMessage += `\`${prefix}help\` - Shows this help message\n`;
        helpMessage += `\`${prefix}ping\` - Check bot response time\n`;
        helpMessage += `\`${prefix}players\` - Show currently online players\n`;
        helpMessage += `\`${prefix}restart\` - Initiate server restart (requires ${this.requiredConfirmations} user confirmations)\n`;
        helpMessage += `\`${prefix}start\` - Start the server (requires confirmations or admin)\n`;
        helpMessage += `\`${prefix}checkupdate\` - Check for mod updates\n`;
        helpMessage += `\`${prefix}killboard\` - Display the top 10 killboard\n`;
        helpMessage += `\`${prefix}killboardrc\` - Display the top 10 killboard (Raven Creek Legend) \n`;
        helpMessage += `\`${prefix}topplaytime\` - Display the top 10 players by playtime - (Under development)\n`;
        helpMessage += `\`${prefix}serverinfo\` - Display server info from BattleMetrics\n\n`;

        // Whitelist section
        helpMessage += '**Whitelist Commands:**\n';
        helpMessage += `\`${prefix}whitelistrequest <steamid> <username> <password>\` - Request to be whitelisted. Your Discord account and username must not already be registered. Your message will be deleted for security.\n`;
        helpMessage += `\`${prefix}resetpassword <oldpassword> <newpassword>\` - Reset your whitelist password. You must provide your current password. Your message will be deleted for security.\n\n`;

        // How to Whitelist section
        helpMessage += '**How to Whitelist:**\n';
        helpMessage += '1. Use the command above with your SteamID64, desired username, and password.\n';
        helpMessage += '2. Example: `!whitelistrequest 76561198000000000 MyUsername MyPassword`\n';
        helpMessage += '3. Your message will be deleted for your safety. If successful, you will be whitelisted and given the Whitelisted role.\n\n';
        helpMessage += '**Note:** Please do whitelistrequest in the Support Ticket Channel, so your data is not **EXPOSED**.\n\n';

        helpMessage += '**S3 Wallet Commands:**\n';
        helpMessage += `\`${prefix}checkdeposit\` - Check your point deposit (Change your display name to your in-game name)\n`;
        helpMessage += `\`${prefix}checkraiddeposit\` - Check your raid points deposit (Change your display name to your in-game name)\n\n`;

        helpMessage += '**Admin Commands:**\n';
        helpMessage += `\`${prefix}adduser <username> <password>\` - Add a user to the whitelist (requires @admin role)\n`;
        helpMessage += `\`${prefix}removeuserfromwhitelist <username>\` - Remove a user from the whitelist (requires @admin role)\n`;
        helpMessage += `\`${prefix}devhelp\` - Show developer/admin commands for ZM_ClientExecutor (requires @admin/@developer role)\n`;
        helpMessage += `\`${prefix}cronstatus\` - Check cron job execution status (requires @admin/@developer role)\n`;
        helpMessage += `\`${prefix}testcron <supply|tank|both>\` - Manually test cron jobs (requires @admin/@developer role)\n\n`;

        helpMessage += '**Note:** Server commands may take a moment to process depending on server load.';

        message.channel.send(helpMessage);
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
            conn.on('ready', () => {
              conn.exec('./pzserver details', (err, stream) => {
                if (err) {
                  conn.end();
                  return reject(err);
                }

                stream.on('data', (data) => {
                  serverDetails += data.toString();
                });

                stream.on('close', () => {
                  conn.end();
                  resolve();
                });

                stream.stderr.on('data', (data) => {
                  console.error(`SSH stderr: ${data.toString()}`);
                });
              });
            }).on('error', reject).connect(sshConfig);
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
        const username = message.member?.displayName || message.author.username
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
                conn.on('ready', () => {
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
                }).on('error', reject).connect(sshConfig);
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
              return message.channel.send(
                `Server start is on cooldown. Please wait ${remainingMinutes} more minutes before starting again.`
              );
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

          const filter = m => ['confirm', 'cancel'].includes(m.content.toLowerCase());
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
                  conn.on('ready', () => {
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
                  }).on('error', reject).connect(sshConfig);
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
        // Usage: !whitelistrequest <steamid> <username1> <password1>
        if (args.length < 3) {
          try {
            if (message.deletable) await message.delete();
          } catch (e) {
            console.error('Failed to delete message with sensitive info:', e);
          }
          return message.channel.send('❌ Missing arguments! Usage: `!whitelistrequest <steamid> <username1> <password1>`');
        }

        const [steamid, username1, password1] = args;
        const discordid = message.author.tag;
        const discordUserId = message.author.id;

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
          // Check if discordid or username already exists in the database
          const existingByDiscord = await zmUsersDb.findUserByDiscordId(discordid);
          const existingByUsername = zmUsersDb.findUserByUsername
            ? await zmUsersDb.findUserByUsername(username1)
            : null;

          if (existingByDiscord) {
            return message.channel.send('❌ Your Discord account is already registered in the whitelist database.');
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

          // 3. Insert all data to Supabase
          await zmUsersDb.addUser({
            discordid: discordid,
            steamid: steamid,
            username1: username1,
            password1: password1,
            extradata: `Requested by ${message.author.tag} on ${new Date().toISOString()}`
          });

          // 4. Give "Whitelisted" role to the user
          const whitelistedRole = message.guild.roles.cache.find(
            role => role.name.toLowerCase() === 'whitelisted'
          );
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
          let helpMessage = '**🔧 Developer Commands (ZM_ClientExecutor)**\n\n';
          helpMessage += '```\n';
          helpMessage += '!devplayersay <username> <message> - Make player say a message\n';
          helpMessage += '!devsetflag <username> <flagname> - Set flag on player\n';
          helpMessage += '!devremoveflag <username> <flagname> - Remove flag from player\n';
          helpMessage += '!devtoggleflag <username> <flagname> - Toggle ZM flag on player\n';
          helpMessage += '!devsethours <username> <hours> - Set hours survived for player\n';
          helpMessage += '!devsetzombiekills <username> <kills> - Set zombie kills for player\n';
          helpMessage += '!devenchant <username> <minDMG> <maxDMG> <enchant> <name> - Apply enchantment to weapon\n';
          helpMessage += '!devsetserverwideflag <flagname> <value> - Set server-wide flag via SFTP\n';
          helpMessage += '!devsetglobalflag <flagname> <true|false> - Set global flag via SFTP\n';
          helpMessage += '```\n\n';
          helpMessage += '**🕰️ Cron Job Management:**\n';
          helpMessage += '```\n';
          helpMessage += '!cronstatus - Check cron job execution status and schedule\n';
          helpMessage += '!testcron supply - Manually test supply run reset\n';
          helpMessage += '!testcron tank - Manually test tank flags reset\n';
          helpMessage += '!testcron both - Manually test both cron jobs\n';
          helpMessage += '```\n';
          helpMessage += '**Note:** All commands require @admin or @developer role.\n';
          helpMessage += '**Schedule:** Supply run reset at 12:01 PM WIB, Tank flags reset at 12:02 PM WIB daily.';
          return message.channel.send(helpMessage);
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
        }

        else if (devCommand === 'setflag') {
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
        }

        else if (devCommand === 'removeflag') {
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
        }

        else if (devCommand === 'toggleflag') {
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
        }

        else if (devCommand === 'sethours') {
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
        }

        else if (devCommand === 'setzombiekills') {
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
        }

        else if (devCommand === 'enchant') {
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
        }

        else if (devCommand === 'setserverwideflag') {
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
        }

        else if (devCommand === 'setglobalflag') {
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
        }

        else {
          message.channel.send(`❌ Unknown developer command: ${devCommand}. Use \`!devhelp\` to see available commands.`);
        }

      }
    });
  }

  setupCronJobs() {
    // Daily supply run reset at 12:01 PM WIB (UTC+7)
    // Cron format: '01 12 * * *' means every day at 12:01 PM
    // Since WIB is UTC+7, we need to schedule at 05:01 UTC
    cron.schedule('01 12 * * *', async () => {
      const executionTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
      try {
        console.log(`🕐 [${executionTime}] Running daily supply run reset at 12:01 PM WIB...`);

        // Update server flags directly via SFTP
        const flagUpdates = {
          supplyRunAvailableFlag: 1,
          supplyRunCompleted: 0
        };

        await this.sftpLogReader.updateMultipleServerFlags(flagUpdates);
        console.log(`✅ [${executionTime}] Daily supply run reset completed successfully via SFTP!`);

        // Update tracking
        this.lastCronExecution.supplyRun = new Date();
        this.lastCronExecution.supplyRunSuccess = true;

        // Send Discord notification
        await this.sendCronNotification('supply run', true, executionTime);

        // Optionally send a server message to notify players
        try {
          await this.wrappedRconClient.send('servermsg "Supply Run has been reset! New supply runs are now available."');
        } catch (msgError) {
          console.warn('Could not send server message:', msgError.message);
        }

      } catch (error) {
        console.error(`❌ [${executionTime}] Error during daily supply run reset:`, error);
        this.lastCronExecution.supplyRun = new Date();
        this.lastCronExecution.supplyRunSuccess = false;
        await this.sendCronNotification('supply run', false, executionTime, error.message);
      }
    }, {
      timezone: 'Asia/Jakarta' // WIB timezone
    });

    // Daily tank flags reset at 12:02 PM WIB (UTC+7)
    // Reset daily tank flags to false every day
    cron.schedule('02 12 * * *', async () => {
      const executionTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
      try {
        console.log(`🕐 [${executionTime}] Running daily tank flags reset at 12:02 PM WIB...`);

        // Update global flags directly via SFTP
        const tankFlagUpdates = {
          daily_tankWB02_flag: false,
          daily_tankWB01_flag: false
        };

        await this.sftpLogReader.updateGlobalFlags(tankFlagUpdates);
        console.log(`✅ [${executionTime}] Daily tank flags reset completed successfully via SFTP!`);

        // Update tracking
        this.lastCronExecution.tankFlags = new Date();
        this.lastCronExecution.tankFlagsSuccess = true;

        // Send Discord notification
        await this.sendCronNotification('tank flags', true, executionTime);

        // Optionally send a server message to notify players
        try {
          await this.wrappedRconClient.send('servermsg "Daily tank events have been reset! Tank spawns are now available again."');
        } catch (msgError) {
          console.warn('Could not send tank reset server message:', msgError.message);
        }

      } catch (error) {
        console.error(`❌ [${executionTime}] Error during daily tank flags reset:`, error);
        this.lastCronExecution.tankFlags = new Date();
        this.lastCronExecution.tankFlagsSuccess = false;
        await this.sendCronNotification('tank flags', false, executionTime, error.message);
      }
    }, {
      timezone: 'Asia/Jakarta' // WIB timezone
    });

    console.log('📅 Cron jobs scheduled:');
    console.log(`   - Daily supply run reset at 12:01 PM WIB (via SFTP) - Current server time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })}`);
    console.log('   - Daily tank flags reset at 12:02 PM WIB (via SFTP)');
  }

  async sendCronNotification(jobType, success, executionTime, errorMessage = null) {
    try {
      // Try to find a logs or monitoring channel
      const logChannels = ['logs', 'monitoring', 'admin-logs', 'bot-logs'];
      let logChannel = null;

      for (const channelName of logChannels) {
        logChannel = this.client.channels.cache.find(channel =>
          channel.name.toLowerCase().includes(channelName) && channel.type === 0
        );
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

  // Make sure to clean up when the bot is shutting down
  cleanup() {
    if (this.rconHeartbeatInterval) {
      clearInterval(this.rconHeartbeatInterval);
      this.rconHeartbeatInterval = null;
    }
  }
}