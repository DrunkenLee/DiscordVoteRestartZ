import cron from 'node-cron';

export class BotLuaCommandManager {
  constructor() {
    this.wrappedRconClient = null;
    this.isolationZoneJob = null;
    this.isActive = false;
    this.discordClient = null; // Add Discord client reference
  }

  initialize(wrappedRconClient, discordClient = null) {
    this.wrappedRconClient = wrappedRconClient;
    this.discordClient = discordClient;
    this.setupIsolationZoneScheduler();
    console.log('🎯 Bot Lua Command Manager initialized');
  }

  setupIsolationZoneScheduler() {
    // Run every 5 minutes to check if we're in the time range
    this.isolationZoneJob = cron.schedule(
      '*/5 * * * *', // Every 5 minutes
      async () => {
        await this.checkAndExecuteIsolationZone();
      },
      {
        timezone: 'Asia/Jakarta', // WIB timezone
        scheduled: true
      }
    );

    console.log('⏰ Isolation Zone Horde checker scheduled: Every 5 minutes between 7 PM - 12 AM WIB');
  }

  // Add method to find a notification channel
  async getNotificationChannel() {
    if (!this.discordClient) return null;

    // Look for channels in this priority order
    const channelNames = ['logs', 'monitoring', 'admin-logs', 'bot-logs', 'general'];

    for (const guild of this.discordClient.guilds.cache.values()) {
      for (const channelName of channelNames) {
        const channel = guild.channels.cache.find(ch =>
          ch.name.toLowerCase() === channelName && ch.type === 0 // Text channel
        );
        if (channel) return channel;
      }
    }

    return null;
  }

  // Add method to send Discord notifications
  async sendDiscordNotification(message) {
    try {
      const channel = await this.getNotificationChannel();
      if (channel) {
        await channel.send(message);
      }
    } catch (error) {
      console.error('Failed to send Discord notification:', error.message);
    }
  }

  async checkAndExecuteIsolationZone() {
    try {
      const now = new Date();
      const wibTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const currentHour = wibTime.getHours();
      const currentMinute = wibTime.getMinutes();

      // ADD DEBUGGING - Always log current status
      console.log(`🕐 [DEBUG] Current WIB time: ${wibTime.toLocaleString()}`);
      console.log(`🕐 [DEBUG] Current hour: ${currentHour}, Current minute: ${currentMinute}`);
      console.log(`🕐 [DEBUG] isActive status: ${this.isActive}`);

      // Check if current time is between 7 PM (19:00) and 12 AM (24:00/0:00)
      const isInTimeRange = currentHour >= 19 || currentHour === 0;
      console.log(`🕐 [DEBUG] isInTimeRange: ${isInTimeRange} (currentHour >= 19: ${currentHour >= 19}, currentHour === 0: ${currentHour === 0})`);

      if (isInTimeRange) {
        if (!this.isActive) {
          const enterMessage = `🌙 [${wibTime.toLocaleString()}] Entering isolation zone active period (7 PM - 12 AM WIB)`;
          console.log(enterMessage);

          // Send Discord notification
          await this.sendDiscordNotification(
            `🌙 **Entering Isolation Zone Horde Period**\n` +
            `**Time:** ${wibTime.toLocaleString()} WIB\n` +
            `**Status:** Horde checks will now run every 5 minutes until 12 AM`
          );

          this.isActive = true;
        }

        // Execute the isolation zone horde check
        console.log(`🔍 [${wibTime.toLocaleString()}] Starting isolation zone horde check...`);

        if (this.wrappedRconClient) {
          try {
            // Step 1: Get all players online
            console.log(`👥 [${wibTime.toLocaleString()}] Checking for online players...`);
            const playersResponse = await this.wrappedRconClient.send('players');

            // Step 2: Parse player list and check if any players are online
            const playerLines = playersResponse.split('\n').filter(line => line.trim() && !line.includes('Players connected'));
            const onlinePlayers = [];

            for (const line of playerLines) {
              // Extract username from player line, removing any leading "-" character
              // Format usually: "-admin (id=X)" or "-username1 (id=X)"
              const match = line.match(/^-?([^\s(]+)/);
              if (match) {
                onlinePlayers.push(match[1]); // This will get "admin", "username1", "username2" without the "-"
              }
            }

            console.log(`👥 [${wibTime.toLocaleString()}] Found ${onlinePlayers.length} players online: ${onlinePlayers.join(', ')}`);

            // Step 3: If no players online, return early
            if (onlinePlayers.length === 0) {
              console.log(`⏸️ [${wibTime.toLocaleString()}] No players online - skipping isolation zone horde check`);
              return;
            }

            let successCount = 0;
            let errorCount = 0;

            for (const player of onlinePlayers) {
              try {
                // successCount++;

                // Add a small delay between commands to avoid overwhelming the server
                // await new Promise(resolve => setTimeout(resolve, 100));

              } catch (playerError) {
                console.error(`❌ [${wibTime.toLocaleString()}] Failed to execute for player ${player}:`, playerError.message);
                errorCount++;
              }
            }

            console.log(`📊 [${wibTime.toLocaleString()}] Isolation zone horde check completed - Success: ${successCount}/${onlinePlayers.length}, Errors: ${errorCount}`);

          } catch (rconError) {
            console.error(`❌ [${wibTime.toLocaleString()}] Error executing isolation zone command:`, rconError.message);
          }
        } else {
          console.warn(`⚠️ [${wibTime.toLocaleString()}] RCON client not available for isolation zone check`);
        }
      } else {
        console.log(`🕐 [DEBUG] Outside time range - no action taken`);
        if (this.isActive) {
          const exitMessage = `🌅 [${wibTime.toLocaleString()}] Exiting isolation zone active period (outside 7 PM - 12 AM WIB)`;
          console.log(exitMessage);

          // Send Discord notification
          await this.sendDiscordNotification(
            `🌅 **Exiting Isolation Zone Horde Period**\n` +
            `**Time:** ${wibTime.toLocaleString()} WIB\n` +
            `**Status:** Horde checks are now inactive until 7 PM`
          );

          this.isActive = false;
        }
      }
    } catch (error) {
      console.error('Error in isolation zone scheduler:', error);
    }
  }

  // Manual trigger for testing
  async manualTriggerIsolationZone() {
    try {
      const now = new Date();
      const wibTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));

      console.log(`🧪 [${wibTime.toLocaleString()}] Manual isolation zone horde check triggered...`);

      if (this.wrappedRconClient) {
        // Step 1: Get all players online
        console.log(`👥 [${wibTime.toLocaleString()}] Checking for online players...`);
        const playersResponse = await this.wrappedRconClient.send('players');

        // Step 2: Parse player list and check if any players are online
        const playerLines = playersResponse.split('\n').filter(line => line.trim() && !line.includes('Players connected'));
        const onlinePlayers = [];

        for (const line of playerLines) {
          // Extract username from player line, removing any leading "-" character
          // Format usually: "-admin (id=X)" or "-username1 (id=X)"
          const match = line.match(/^-?([^\s(]+)/);
          if (match) {
            onlinePlayers.push(match[1]); // This will get "admin", "username1", "username2" without the "-"
          }
        }

        console.log(`👥 [${wibTime.toLocaleString()}] Found ${onlinePlayers.length} players online: ${onlinePlayers.join(', ')}`);

        // Step 3: If no players online, return early
        if (onlinePlayers.length === 0) {
          console.log(`⏸️ [${wibTime.toLocaleString()}] No players online - cannot execute isolation zone horde check`);
          throw new Error('No players online - isolation zone check requires at least one player');
        }

        // Step 4: Execute command for ALL players online
        console.log(`🎯 [${wibTime.toLocaleString()}] Executing manual isolation zone horde check for all ${onlinePlayers.length} players...`);

        let successCount = 0;
        let errorCount = 0;

        for (const player of onlinePlayers) {
          try {
            console.log(`🔄 [${wibTime.toLocaleString()}] Executing for player: ${player}`);
            await this.wrappedRconClient.send(`luacmd clientexe ${player} checkIsolationZoneHorde`);
            console.log(`✅ [${wibTime.toLocaleString()}] Successfully executed for player: ${player}`);
            successCount++;

            // Add a small delay between commands to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));

          } catch (playerError) {
            console.error(`❌ [${wibTime.toLocaleString()}] Failed to execute for player ${player}:`, playerError.message);
            errorCount++;
          }
        }

        console.log(`📊 [${wibTime.toLocaleString()}] Manual isolation zone horde check completed - Success: ${successCount}/${onlinePlayers.length}, Errors: ${errorCount}`);

        if (errorCount > 0) {
          throw new Error(`Some commands failed - Success: ${successCount}/${onlinePlayers.length}, Errors: ${errorCount}`);
        }

        return true;
      } else {
        throw new Error('RCON client not available');
      }
    } catch (error) {
      console.error('Error in manual isolation zone trigger:', error);
      throw error;
    }
  }

  // Get current status
  getStatus() {
    const now = new Date();
    const wibTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const currentHour = wibTime.getHours();
    const isInTimeRange = currentHour >= 19 || currentHour === 0;

    return {
      currentTime: wibTime.toLocaleString(),
      currentHour: currentHour,
      isInActiveTimeRange: isInTimeRange,
      isActive: this.isActive,
      nextExecution: this.getNextExecutionTime(),
      schedule: 'Every 5 minutes between 7 PM - 12 AM WIB'
    };
  }

  getNextExecutionTime() {
    const now = new Date();
    const wibTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));

    // Calculate next 5-minute interval
    const minutes = wibTime.getMinutes();
    const nextInterval = Math.ceil(minutes / 5) * 5;

    const nextExecution = new Date(wibTime);
    if (nextInterval >= 60) {
      nextExecution.setHours(nextExecution.getHours() + 1);
      nextExecution.setMinutes(0);
    } else {
      nextExecution.setMinutes(nextInterval);
    }
    nextExecution.setSeconds(0);
    nextExecution.setMilliseconds(0);

    return nextExecution.toLocaleString();
  }

  // Cleanup
  cleanup() {
    if (this.isolationZoneJob) {
      this.isolationZoneJob.destroy();
      this.isolationZoneJob = null;
      console.log('🧹 Isolation zone scheduler cleaned up');
    }
  }
}