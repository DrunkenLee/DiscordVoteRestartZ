import { Client, GatewayIntentBits, Events } from 'discord.js';
import config from '../config/config.js';
import { SftpLogReader } from '../utils/sftpLogReader.js';

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
    this.sftpLogReader = new SftpLogReader();

    // Track the last restart time for cooldown
    this.lastRestartTime = null;
    // Required number of confirmations
    this.requiredConfirmations = 3;
    // Cooldown period in milliseconds (1 hour)
    this.restartCooldown = 60 * 60 * 1000;

    // RCON connection management
    this.rconClient = null;
    this.rconHeartbeatInterval = null;
    this.heartbeatIntervalTime = 5 * 60 * 1000; // 5 minutes
    this.isReconnecting = false;
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

          const statusMessage = await message.channel.send('Checking if mods need updates...');

          // Send the mod check command
          const checkResponse = await wrappedRconClient.send('checkModsNeedUpdate');
          console.log('Mod check response:', checkResponse);

          // Response typically indicates the check has started
          await statusMessage.edit('Mod check started. Please wait for the server to process the request...');

          // Since we can't directly check logs, we need to implement a different approach
          setTimeout(async () => {
            // Create a set to track unique users who have confirmed
            const confirmedUsers = new Set();

            // Add the command initiator to the tracking message
            const confirmMsg = await message.channel.send(
              `Do you want to restart the server? **${confirmedUsers.size}/${this.requiredConfirmations}** confirmations received.\n` +
              `Type \`confirm\` within 60 seconds to confirm the restart.\n` +
              `**Note:** At least ${this.requiredConfirmations} different users must confirm.`
            );

            // Create a message collector for confirmations
            const filter = m => m.content.toLowerCase() === 'confirm';
            const collector = message.channel.createMessageCollector({ filter, time: 60000 });

            collector.on('collect', async (m) => {
              // Add the user to the confirmation list if they haven't already confirmed
              if (!confirmedUsers.has(m.author.id)) {
                confirmedUsers.add(m.author.id);

                // Update the confirmation message
                await confirmMsg.edit(
                  `Do you want to restart the server? **${confirmedUsers.size}/${this.requiredConfirmations}** confirmations received.\n` +
                  `Type \`confirm\` within 60 seconds to confirm the restart.\n` +
                  `**Note:** At least ${this.requiredConfirmations} different users must confirm.`
                );

                // If we have enough confirmations, restart the server
                if (confirmedUsers.size >= this.requiredConfirmations) {
                  collector.stop('confirmed');
                }
              }
            });

            collector.on('end', async (collected, reason) => {
              if (reason === 'confirmed') {
                await message.channel.send(`Confirmed by ${confirmedUsers.size} users! Initiating server restart sequence...`);
                try {
                  // First notification to in-game players
                  await wrappedRconClient.send('servermsg "SERVER RESTART: Restart initiated by Discord vote. Server will restart in 2 minutes."');
                  await message.channel.send('In-game notification sent. Waiting 2 minutes before restart...');

                  // Wait 2 minutes (120000 ms)
                  await new Promise(resolve => setTimeout(resolve, 120000));

                  // Second warning - imminent restart
                  await wrappedRconClient.send('servermsg "SERVER RESTART IMMINENT: Saving world and restarting. Please finish what you\'re doing!"');
                  await message.channel.send('Final warning sent. Restarting server in 10 seconds...');

                  // Give players a few more seconds to prepare
                  await new Promise(resolve => setTimeout(resolve, 10000));

                  // Execute the restart
                  await wrappedRconClient.send('quit');
                  await message.channel.send('Server restart command sent successfully.');

                  // Update the last restart time for cooldown
                  this.lastRestartTime = Date.now();
                } catch (restartError) {
                  await message.channel.send(`Error during restart: ${restartError.message}`);
                  console.error('Restart error:', restartError);
                }
              } else {
                await confirmMsg.edit(`Restart canceled. Only ${confirmedUsers.size}/${this.requiredConfirmations} confirmations received.`);
              }
            });
          }, 10000); // Wait 10 seconds for the check to run before asking
        } catch (error) {
          message.channel.send(`Error initiating mod update check: ${error.message}`);
          console.error('Error during restart command:', error);
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

        try {
          // Send the adduser command to the server
          const response = await wrappedRconClient.send(`adduser "${username}" "${password}"`);
          message.channel.send(`✅ User command executed: ${response || 'Command sent, but no response received.'}`);

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
        helpMessage += `\`${prefix}restart\` - Initiate server restart (requires ${this.requiredConfirmations} user confirmations)\n\n`;

        // Admin commands
        helpMessage += '**Admin Commands:**\n';
        helpMessage += `\`${prefix}adduser <username> <password>\` - Add a user to the whitelist (requires @admin role)\n`;
        helpMessage += `\`${prefix}removeuserfromwhitelist <username>\` - Remove a user from the whitelist (requires @admin role)\n\n`;

        // Note about server commands
        helpMessage += '**Note:** Server commands may take a moment to process depending on server load.';

        // Send the help message
        message.channel.send(helpMessage);
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