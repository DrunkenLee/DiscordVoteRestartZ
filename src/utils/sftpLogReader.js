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
    // Directly return the known log file path
    return '/.cache/server-console.txt';
  }

  async checkForModUpdates() {
    try {
      const logPath = await this.findLatestLogFile();

      // Read the log file
      const logContent = await this.sftp.get(logPath);

      // Split content into lines and get the last 50 lines
      const lines = logContent.toString().split('\n');
      const lastLines = lines.slice(-5000);

      // Look for mod update messages in the recent lines
      for (let i = lastLines.length - 1; i >= 0; i--) {
        const line = lastLines[i];
        console.log({ line });
        if (line.includes('CheckModsNeedUpdate: Mods updated')) {
          return {
            success: true,
            needsUpdate: false,
            message: 'Mods are up to date',
          };
        } else if (line.includes('Mods need update')) {
          return {
            success: true,
            needsUpdate: true,
            message: 'Mods need updates',
          };
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