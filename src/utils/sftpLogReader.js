import SftpClient from 'ssh2-sftp-client';
import config from '../config/config.js';

export class SftpLogReader {
  constructor() {
    this.sftp = new SftpClient();
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;

    try {
      await this.sftp.connect({
        host: config.sftp.host,
        port: config.sftp.port,
        username: config.sftp.username,
        password: config.sftp.password,
        // If using key-based authentication:
        // privateKey: config.sftp.privateKey
      });

      this.isConnected = true;
      console.log('SFTP connected successfully');
    } catch (error) {
      console.error('SFTP connection error:', error);
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) return;

    try {
      await this.sftp.end();
      this.isConnected = false;
      console.log('SFTP disconnected');
    } catch (error) {
      console.error('SFTP disconnection error:', error);
    }
  }

  async findLatestLogFile() {
    await this.connect();

    // Path to Project Zomboid server logs
    const logDir = '/.cache/Logs/';

    try {
      // List all files in the directory
      const files = await this.sftp.list(logDir);

      // Filter for DebugLog-server files and find the most recent one
      const serverLogs = files
        .filter(file => file.name.includes('DebugLog-server') && file.type === '-')
        .sort((a, b) => b.modifyTime - a.modifyTime);

      if (serverLogs.length === 0) {
        throw new Error('No server log files found');
      }

      return `${logDir}${serverLogs[0].name}`;
    } catch (error) {
      console.error('Error finding log files:', error);
      throw error;
    }
  }

  async checkForModUpdates() {
    try {
      const latestLogPath = await this.findLatestLogFile();

      // Read the last 100 lines of the log file
      const logContent = await this.sftp.get(latestLogPath);

      // Split content into lines and get the last 150 lines
      const lines = logContent.toString().split('\n');
      const lastLines = lines.slice(-150);

      // Look for mod update messages in the recent lines
      for (let i = lastLines.length - 1; i >= 0; i--) {
        const line = lastLines[i];

        if (line.includes('CheckModsNeedUpdate')) {
          if (line.includes('Mods updated')) {
            return {
              success: true,
              needsUpdate: false,
              message: 'Mods are up to date'
            };
          } else if (line.includes('need to update', 'Mods need update')) {
            return {
              success: true,
              needsUpdate: true,
              message: 'Mods need updates'
            };
          }
        }
      }

      return {
        success: false,
        message: 'No mod update information found in logs'
      };

    } catch (error) {
      console.error('Error checking for mod updates:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    } finally {
      await this.disconnect();
    }
  }
}