import { Client, GatewayIntentBits, Events } from 'discord.js';
import { BattleMetricsAPI } from '../utils/battlemetrics.js';
import config from '../config/config.js';
import { SftpLogReader } from '../utils/sftpLogReader.js';
import { Client as SSHClient } from 'ssh2';
import dotenv from 'dotenv';
import * as zmUsersDb from '../utils/zmUsersDb.js';
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
    this.devMode = true; // Default to false (all commands available)
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
        console.log('Sending RCON heartbeat...');
        await this.sendRconCommand('players');
        console.log('RCON heartbeat successful');
      } catch (error) {
        console.error(`RCON heartbeat failed: ${error.message}`);
        this.reconnectRcon().catch(e => console.error(`Failed to reconnect: ${e.message}`));
      }
    }, this.heartbeatIntervalTime);

    console.log(`RCON heartbeat started, interval: ${this.heartbeatIntervalTime / 1000} seconds`);
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
          const result = await this.sftpLogReader.getKillBoard();
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
      } else if (command === 'help') {
        // Create an embed for better formatting
        const prefix = config.discord.prefix;

        // Create a formatted help message
        let helpMessage = '**🤖 Zona Merah Project Z - Command List 🤖**\n\n';

        // General commands (no role requirements)
        helpMessage += '**General Commands:**\n';
        helpMessage += `\`${prefix}help\` - Shows this help message\n`;
        helpMessage += `\`${prefix}ping\` - Check bot response time\n`;
        helpMessage += `\`${prefix}players\` - Show currently online players\n`;
        helpMessage += `\`${prefix}restart\` - Initiate server restart (requires ${this.requiredConfirmations} user confirmations)\n`;
        helpMessage += `\`${prefix}checkupdate\` - Check for mod updates\n`;
        helpMessage += `\`${prefix}killboard\` - Display the top 10 killboard\n`;
        helpMessage += `\`${prefix}topplaytime\` - Display the top 10 players by playtime\n`;
        helpMessage += `\`${prefix}serverinfo\` - Display server info from BattleMetrics\n\n`;
        helpMessage += '**S3 Wallet Commands:**\n';
        helpMessage += `\`${prefix}checkdeposit\` - Check your point deposit (Change your display name to your in-game name)\n`;
        helpMessage += `\`${prefix}checkraiddeposit\` - Check your raid points deposit (Change your display name to your in-game name)\n\n`;

        helpMessage += '**Admin Commands:**\n';
        helpMessage += `\`${prefix}adduser <username> <password>\` - Add a user to the whitelist (requires @admin role)\n`;
        helpMessage += `\`${prefix}removeuserfromwhitelist <username>\` - Remove a user from the whitelist (requires @admin role)\n\n`;

        // Note about server commands
        helpMessage += '**Note:** Server commands may take a moment to process depending on server load.';

        // Send the help message
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
          return message.channel.send('❌ Missing arguments! Usage: `!whitelistrequest <steamid> <username1> <password1>`');
        }

        const [steamid, username1, password1] = args;
        const discordid = message.author.tag; // Discord tag (e.g., User#1234)
        const discordUserId = message.author.id; // Discord user ID

        // Validate SteamID64 (17 digits, all numbers)
        function isValidSteamID(steamid) {
          return /^\d{17}$/.test(steamid);
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
            const member = await message.guild.members.fetch(discordUserId);
            if (member && !member.roles.cache.has(whitelistedRole.id)) {
              await member.roles.add(whitelistedRole);
            }
          }

          message.channel.send('✅ Whitelist request processed! You are now whitelisted and have been given the Whitelisted role.');
        } catch (err) {
          console.error('Error processing whitelist request:', err);
          message.channel.send(`❌ Error processing whitelist request: ${err.message}`);
        }
      }

      // Add more commands as needed
    });

    this.client.once(Events.ClientReady, () => {
      console.log(`Bot is ready! Logged in as ${this.client.user.tag}`);
    });
  }

  // Make sure to clean up when the bot is shutting down
  cleanup() {
    if (this.rconHeartbeatInterval) {
      clearInterval(this.rconHeartbeatInterval);
      this.rconHeartbeatInterval = null;
    }
  }
}