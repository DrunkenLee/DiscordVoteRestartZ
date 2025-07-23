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
    return '/home/ubuntu/Zomboid/server-console.txt';
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

  async getKillBoard(filename) {
    try {
      await this.connect();
      const iniPath = `/home/ubuntu/Zomboid/Lua/${filename}`;
      const iniContent = await this.sftp.get(iniPath);
      const lines = iniContent.toString().split('\n');
      const killCounts = [];
      let inSection = false;
      let sectionName = '[KillCounts]';
      // Detect section for RavenCreek file
      if (filename.toLowerCase().includes('ravencreek')) {
        sectionName = '[RavenCreekKillCounts]';
      }
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(sectionName)) {
          inSection = true;
          continue;
        }
        if (inSection && trimmed && !trimmed.startsWith(';') && trimmed.includes('=')) {
          const [name, kills] = trimmed.split('=');
          killCounts.push({ name: name.trim(), kills: parseInt(kills.trim(), 10) || 0 });
        }
      }
      // Sort descending and take top 10
      killCounts.sort((a, b) => b.kills - a.kills);
      return killCounts.slice(0, 10);
    } catch (error) {
      console.error('Error reading killboard:', error);
      return [];
    } finally {
      await this.disconnect();
    }
  }

  async getServerPointDepositByUsername(username) {
    try {
      await this.connect();
      const iniPath = `/home/ubuntu/Zomboid/Lua/Deposits/${username}_deposits.ini`;
      const iniContent = await this.sftp.get(iniPath);
      const lines = iniContent.toString().split('\n');
      let total = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('Amount=')) {
          const amount = parseInt(trimmed.split('=')[1], 10);
          if (!isNaN(amount)) {
            total += amount;
          }
        }
      }
      return total;
    } catch (error) {
      console.error('Error reading file:', error);
      return 0;
    } finally {
      await this.disconnect();
    }
  }

  async getRaidPointsDepositByUsername(username) {
    try {
      await this.connect();
      const iniPath = `/home/ubuntu/Zomboid/Lua/RaidDeposits/${username}_raiddeposits.ini`;
      const iniContent = await this.sftp.get(iniPath);
      const lines = iniContent.toString().split('\n');
      let total = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('Amount=')) {
          const amount = parseInt(trimmed.split('=')[1], 10);
          if (!isNaN(amount)) {
            total += amount;
          }
        }
      }
      return total;
    } catch (error) {
      console.error('Error reading file:', error);
      return 0;
    } finally {
      await this.disconnect();
    }
  }

  async updateServerFlag(flagName, value) {
    try {
      await this.connect();

      const flagsFilePath = '/home/ubuntu/Zomboid/Lua/ZonaMerah_ServerFlags.ini';

      // Read current file content
      let fileContent;
      try {
        const buffer = await this.sftp.get(flagsFilePath);
        fileContent = buffer.toString('utf8');
      } catch (readError) {
        // If file doesn't exist, create default content
        console.log('Server flags file not found, creating new one...');
        fileContent = `[ServerFlags]
supplyRunAvailableFlag=0
expeditionRunAvailableFlag=0
eventActiveFlag=0
maintenanceModeFlag=0
specialEventFlag=0
pvpEnabledFlag=0
tradingEnabledFlag=1
questSystemEnabledFlag=1
serverMessage="Welcome to ZonaMerah"
eventDescription=""`;
      }

      // Update the specific flag
      const flagPattern = new RegExp(`^${flagName}=.*$`, 'm');
      if (flagPattern.test(fileContent)) {
        // Flag exists, update it
        fileContent = fileContent.replace(flagPattern, `${flagName}=${value}`);
      } else {
        // Flag doesn't exist, add it under [ServerFlags] section
        const serverFlagsPattern = /(\[ServerFlags\]\s*\n)/;
        if (serverFlagsPattern.test(fileContent)) {
          fileContent = fileContent.replace(serverFlagsPattern, `$1${flagName}=${value}\n`);
        } else {
          // No [ServerFlags] section, add everything
          fileContent = `[ServerFlags]\n${flagName}=${value}\n` + fileContent;
        }
      }

      // Write updated content back to file
      await this.sftp.put(Buffer.from(fileContent, 'utf8'), flagsFilePath);

      console.log(`✅ Updated server flag '${flagName}' to '${value}' in ${flagsFilePath}`);
      return true;

    } catch (error) {
      console.error('Error updating server flag:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }

  async updateMultipleServerFlags(flagUpdates) {
    try {
      await this.connect();

      const flagsFilePath = '/home/ubuntu/Zomboid/Lua/ZonaMerah_ServerFlags.ini';

      // Read current file content
      let fileContent;
      try {
        const buffer = await this.sftp.get(flagsFilePath);
        fileContent = buffer.toString('utf8');
      } catch (readError) {
        // If file doesn't exist, create default content
        console.log('Server flags file not found, creating new one...');
        fileContent = `[ServerFlags]
supplyRunAvailableFlag=0
expeditionRunAvailableFlag=0
eventActiveFlag=0
maintenanceModeFlag=0
specialEventFlag=0
pvpEnabledFlag=0
tradingEnabledFlag=1
questSystemEnabledFlag=1
serverMessage="Welcome to ZonaMerah"
eventDescription=""`;
      }

      // Update each flag
      for (const [flagName, value] of Object.entries(flagUpdates)) {
        const flagPattern = new RegExp(`^${flagName}=.*$`, 'm');
        if (flagPattern.test(fileContent)) {
          // Flag exists, update it
          fileContent = fileContent.replace(flagPattern, `${flagName}=${value}`);
        } else {
          // Flag doesn't exist, add it under [ServerFlags] section
          const serverFlagsPattern = /(\[ServerFlags\]\s*\n)/;
          if (serverFlagsPattern.test(fileContent)) {
            fileContent = fileContent.replace(serverFlagsPattern, `$1${flagName}=${value}\n`);
          } else {
            // No [ServerFlags] section, add everything
            fileContent = `[ServerFlags]\n${flagName}=${value}\n` + fileContent;
          }
        }
      }

      // Write updated content back to file
      await this.sftp.put(Buffer.from(fileContent, 'utf8'), flagsFilePath);

      console.log(`✅ Updated multiple server flags in ${flagsFilePath}:`, flagUpdates);
      return true;

    } catch (error) {
      console.error('Error updating multiple server flags:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }

  async updateGlobalFlags(flagUpdates) {
    try {
      await this.connect();

      const globalFlagsFilePath = '/home/ubuntu/Zomboid/Lua/ZMData/ZM_GlobalFlags.lua';

      // Read current file content
      let fileContent;
      try {
        const buffer = await this.sftp.get(globalFlagsFilePath);
        fileContent = buffer.toString('utf8');
      } catch (readError) {
        // If file doesn't exist, create default content
        console.log('Global flags file not found, creating new one...');
        fileContent = `return {
    ["daily_tankWB02_flag"] = true,
    ["daily_tankWB01_flag"] = true,
    ["weekly_test01_flag"] = true,
    ["weekly_test02_flag"] = true,
    ["supplyRun_Jessica_taken"] = true,
    }`;
    }

      // Update each flag in the Lua format
      for (const [flagName, value] of Object.entries(flagUpdates)) {
        const flagPattern = new RegExp(`(\\["${flagName}"\\]\\s*=\\s*)(true|false)`, 'g');
        if (flagPattern.test(fileContent)) {
          // Flag exists, update it
          fileContent = fileContent.replace(flagPattern, `$1${value}`);
        } else {
          // Flag doesn't exist, add it before the closing brace
          const closingBracePattern = /(\s*}[^}]*$)/;
          if (closingBracePattern.test(fileContent)) {
            fileContent = fileContent.replace(closingBracePattern, `    ["${flagName}"] = ${value},\n$1`);
          } else {
            // No proper structure, create one
            fileContent = `return {\n    ["${flagName}"] = ${value},\n}`;
          }
        }
      }

      // Write updated content back to file
      await this.sftp.put(Buffer.from(fileContent, 'utf8'), globalFlagsFilePath);

      console.log(`✅ Updated global flags in ${globalFlagsFilePath}:`, flagUpdates);
      return true;

    } catch (error) {
      console.error('Error updating global flags:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}