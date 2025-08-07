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

      // Check if current time is between 7 PM (19:00) and 12 AM (24:00/0:00)
      const isInTimeRange = currentHour >= 19 || currentHour === 0;

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
        console.log(`🔍 [${wibTime.toLocaleString()}] Executing isolation zone horde check...`);

        if (this.wrappedRconClient) {
          try {
            await this.wrappedRconClient.send('luacmd clientexe checkIsolationZoneHorde');
            console.log(`✅ [${wibTime.toLocaleString()}] Isolation zone horde check executed successfully`);
          } catch (rconError) {
            console.error(`❌ [${wibTime.toLocaleString()}] Error executing isolation zone command:`, rconError.message);
          }
        } else {
          console.warn(`⚠️ [${wibTime.toLocaleString()}] RCON client not available for isolation zone check`);
        }
      } else {
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
        await this.wrappedRconClient.send('luacmd clientexe checkIsolationZoneHorde');
        console.log(`✅ [${wibTime.toLocaleString()}] Manual isolation zone horde check completed`);
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