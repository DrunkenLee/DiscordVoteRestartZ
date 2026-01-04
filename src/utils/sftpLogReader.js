import SftpClient from 'ssh2-sftp-client';
import config from '../config/config.js';

export class SftpLogReader {
  constructor() {
    this.sftp = new SftpClient();
    this.isConnected = false;
    this.connectionQueue = Promise.resolve();
    this.operationCount = 0;
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
      this.isConnected = false;
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
      this.isConnected = false;
    }
  }

  /**
   * Execute an operation with proper connection queuing to prevent conflicts
   * @param {Function} operation - Async function to execute with SFTP
   * @returns {Promise} - Result of the operation
   */
  async executeWithQueue(operation) {
    // Queue this operation after any pending operations
    const previousOperation = this.connectionQueue;

    let resolver;
    const currentOperation = new Promise((resolve) => {
      resolver = resolve;
    });

    this.connectionQueue = currentOperation;

    try {
      // Wait for previous operations to complete
      await previousOperation;

      // Execute this operation
      const result = await operation();
      return result;
    } finally {
      // Mark this operation as complete
      resolver();
    }
  }

  async findLatestLogFile() {
    await this.connect();
    // Directly return the known log file path
    return '/home/pzserver/Zomboid/server-console.txt';
  }

  async checkForModUpdates() {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();

        const logPath = '/home/pzserver/Zomboid/server-console.txt';
        console.log(`[ModUpdateChecker] Reading log file: ${logPath}`);

        // Read the log file - simplified approach
        let logContent;
        try {
          logContent = await this.sftp.get(logPath);
        } catch (getError) {
          console.error('[ModUpdateChecker] Failed to read log file:', getError.message);
          return {
            success: false,
            message: `Unable to read server log: ${getError.message}`
          };
        }

        // Split content into lines and get the last 5000 lines
        const lines = logContent.toString('utf8').split('\n');
        const lastLines = lines.slice(-5000);

        console.log(`[ModUpdateChecker] Scanning ${lastLines.length} recent log lines...`);

        // Look for mod update messages in the recent lines
        for (let i = lastLines.length - 1; i >= 0; i--) {
          const line = lastLines[i];
          if (line.includes('CheckModsNeedUpdate: Mods updated')) {
            console.log('[ModUpdateChecker] Found: Mods are up to date');
            return {
              success: true,
              needsUpdate: false,
              message: 'Mods are up to date',
            };
          } else if (line.includes('Mods need update')) {
            console.log('[ModUpdateChecker] Found: Mods need updates');
            return {
              success: true,
              needsUpdate: true,
              message: 'Mods need updates',
            };
          }
        }

        return {
          success: false,
          message: 'No mod update information found in recent logs (checked last 5000 lines)'
        };

      } catch (error) {
        console.error('[ModUpdateChecker] Error checking for mod updates:', error);
        return {
          success: false,
          message: `Error: ${error.message}`
        };
      } finally {
        await this.disconnect();
      }
    });
  }

  async getKillBoard(filename) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();
        const iniPath = `/home/josplay5/Zomboid/Lua/${filename}`;
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
    });
  }

  async getServerPointDepositByUsername(username) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();
        const iniPath = `/home/josplay5/Zomboid/Lua/Deposits/${username}_deposits.ini`;
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
    });
  }

  async getRaidPointsDepositByUsername(username) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();
        const iniPath = `/home/josplay5/Zomboid/Lua/RaidDeposits/${username}_raiddeposits.ini`;
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
    });
  }

  async updateServerFlag(flagName, value) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();

        const flagsFilePath = '/home/josplay5/Zomboid/Lua/ZonaMerah_ServerFlags.ini';

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
    });
  }

  async updateMultipleServerFlags(flagUpdates) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();

        const flagsFilePath = '/home/josplay5/Zomboid/Lua/ZonaMerah_ServerFlags.ini';

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
    });
  }

  async updateGlobalFlags(flagUpdates) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();

        const globalFlagsFilePath = '/home/josplay5/Zomboid/Lua/ZMData/ZM_GlobalFlags.lua';

        // Read current file content
        let fileContent;
        try {
          const buffer = await this.sftp.get(globalFlagsFilePath);
          fileContent = buffer.toString('utf8');
        } catch (readError) {
          // If file doesn't exist, create default content
          console.log('Global flags file not found, creating new one...');
          fileContent = `return {
    ["randomizedWorldBoss_day"] = true,
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
    });
  }

  /**
   * Scan all dedicated auction log files (JSONL format) matching pattern auction_data*.jsonl
   * Note: startPosition is ignored in multi-file mode and kept for backward compatibility
   * @param {number} startPosition - Deprecated; retained for signature compatibility
   * @returns {Object} - { auctionEntries: Array<object>, filesProcessed: Array<string>, newPosition: number, success: boolean }
   */
  async scanForAuctionLogs(startPosition = 0) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();

        const auctionLogDir = '/home/josplay5/Zomboid/Lua';
        console.log(`[AuctionLogScanner] Scanning auction log directory: ${auctionLogDir}`);

        // List files in the directory and filter by pattern auction_data*.jsonl
        let listing = [];
        try {
          listing = await this.sftp.list(auctionLogDir);
        } catch (e) {
          console.error(`[AuctionLogScanner] Failed to list directory ${auctionLogDir}:`, e);
          return {
            auctionEntries: [],
            filesProcessed: [],
            newPosition: 0,
            success: false,
            error: e.message
          };
        }

        const candidates = listing
          .filter(f => f.type === '-' && f.name.startsWith('auction_data') && f.name.endsWith('.jsonl'))
          // Sort by modified time ascending (older first), fallback to name
          .sort((a, b) => (a.modifyTime || 0) - (b.modifyTime || 0) || a.name.localeCompare(b.name));

        if (candidates.length === 0) {
          return {
            auctionEntries: [],
            filesProcessed: [],
            newPosition: 0,
            success: true,
            message: 'No auction_data*.jsonl files found - nothing to process'
          };
        }

        const auctionEntries = [];
        const filesProcessed = [];

        for (const file of candidates) {
          const filePath = `${auctionLogDir}/${file.name}`;
          console.log(`[AuctionLogScanner] Reading auction log file: ${filePath}`);
          try {
            const contentBuf = await this.sftp.get(filePath);
            const content = contentBuf.toString();
            const lines = content.split('\n');
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;
              try {
                const auctionEntry = JSON.parse(trimmedLine);
                auctionEntries.push(auctionEntry);
                console.log(`[AuctionLogScanner] Found auction entry:`, {
                  action: auctionEntry.action,
                  timestamp: auctionEntry.timestamp,
                  data: auctionEntry.data
                });
              } catch (parseError) {
                console.error(`[AuctionLogScanner] Failed to parse JSON line in ${file.name}:`, parseError);
                console.error(`[AuctionLogScanner] Raw line:`, trimmedLine);
              }
            }
            filesProcessed.push(filePath);
          } catch (readErr) {
            console.error(`[AuctionLogScanner] Error reading file ${filePath}:`, readErr);
            // Skip this file; do not mark as processed so it can be retried
          }
        }

        console.log(`[AuctionLogScanner] Scan complete. Found ${auctionEntries.length} auction entries across ${filesProcessed.length} files.`);

        // In multi-file mode, newPosition is not meaningful; set to 0
        return {
          auctionEntries,
          filesProcessed,
          newPosition: 0,
          success: true
        };

      } catch (error) {
        console.error('[AuctionLogScanner] Error scanning auction logs:', error);
        return {
          auctionEntries: [],
          newPosition: startPosition,
          success: false,
          error: error.message
        };
      } finally {
        await this.disconnect();
      }
    });
  }

  /**
   * Get the current size/position of the auction log file for tracking
   * @returns {number} - Current file size in bytes
   */
  async getAuctionLogFileSize() {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();
        const auctionLogDir = '/home/josplay5/Zomboid/Lua';
        try {
          const listing = await this.sftp.list(auctionLogDir);
          const files = listing.filter(f => f.type === '-' && f.name.startsWith('auction_data') && f.name.endsWith('.jsonl'));
          // Return total bytes as a rough metric
          let total = 0;
          for (const f of files) {
            try {
              const st = await this.sftp.stat(`${auctionLogDir}/${f.name}`);
              total += st.size || 0;
            } catch {
              // ignore stat errors for individual files
            }
          }
          return total;
        } catch (e) {
          console.log('[AuctionLogScanner] Auction log directory not accessible, returning size 0');
          return 0;
        }
      } catch (error) {
        console.error('[AuctionLogScanner] Error getting auction log file size:', error);
        return 0;
      } finally {
        await this.disconnect();
      }
    });
  }

  /**
   * Delete processed auction log files after successful processing
   * @param {string[]} filePaths - Absolute paths of files to delete
   * @returns {boolean} - True if deletion succeeded for all files
   */
  async deleteAuctionLogFiles(filePaths = []) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return true;

    return this.executeWithQueue(async () => {
      try {
        await this.connect();
        for (const fp of filePaths) {
          try {
            await this.sftp.delete(fp);
            console.log(`[AuctionLogScanner] Deleted processed auction log file: ${fp}`);
          } catch (e) {
            console.error(`[AuctionLogScanner] Failed to delete ${fp}:`, e);
            throw e;
          }
        }
        return true;
      } catch (error) {
        console.error('[AuctionLogScanner] Error deleting auction log files:', error);
        throw error;
      } finally {
        await this.disconnect();
      }
    });
  }

  /**
   * Get the next auction number by scanning existing auction*.json files
   * @param {boolean} keepConnection - If true, don't disconnect after operation
   * @returns {number} - Next available auction number (1 if no files exist)
   */
  async getNextAuctionNumber(keepConnection = false) {
    // Note: This method is called within createAuctionWinFile which is already queued,
    // so we don't need to wrap it again to avoid double-queueing
    try {
      await this.connect();
      const auctionLogDir = '/home/josplay5/Zomboid/Lua/AuctionLog';

      // Check if directory exists
      try {
        await this.sftp.stat(auctionLogDir);
      } catch (statError) {
        // Directory doesn't exist, return 1 as first auction number
        return 1;
      }

      // List files in auction directory
      let listing = [];
      try {
        listing = await this.sftp.list(auctionLogDir);
      } catch (listError) {
        // Can't list directory, return 1 as first auction number
        return 1;
      }

      // Filter for auction*.json files and extract numbers
      const auctionNumbers = listing
        .filter(f => f.type === '-' && f.name.match(/^auction(\d+)\.json$/))
        .map(f => {
          const match = f.name.match(/^auction(\d+)\.json$/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);

      // Return the highest number + 1, or 1 if no auction files exist
      return auctionNumbers.length > 0 ? Math.max(...auctionNumbers) + 1 : 1;

    } catch (error) {
      console.error('[AuctionWin] Error getting next auction number:', error);
      // Fallback to 1 if there's any error
      return 1;
    } finally {
      if (!keepConnection) {
        await this.disconnect();
      }
    }
  }  /**
   * Create auction win file on server as JSON format for Lua parsing
   * @param {string} playerUsername - Winner's username1 from zmusers table
   * @param {object} auctionData - Complete auction data object
   * @returns {boolean} - True if file creation succeeded
   */
  async createAuctionWinFile(playerUsername, auctionData) {
    return this.executeWithQueue(async () => {
      try {
        await this.connect();

        // Get next sequential auction number (keep connection open)
        const auctionNumber = await this.getNextAuctionNumber(true);
        const fileName = `auction${auctionNumber}.json`;
        const auctionLogDir = '/home/josplay5/Zomboid/Lua/AuctionLog';
        const filePath = `${auctionLogDir}/${fileName}`;

        // Ensure directory exists (create if not)
        try {
          await this.sftp.stat(auctionLogDir);
        } catch (statError) {
          // Directory doesn't exist, create it
          await this.sftp.mkdir(auctionLogDir, true);
          console.log(`[AuctionWin] Created directory: ${auctionLogDir}`);
        }

        // Format auction data as JSON for Lua consumption
        const jsonContent = this.formatAuctionWinDataAsJSON(auctionData);

        // Write JSON file to server
        await this.sftp.put(Buffer.from(jsonContent, 'utf8'), filePath);
        console.log(`[AuctionWin] Created auction win JSON file: ${filePath} (for player: ${playerUsername})`);

        return true;
      } catch (error) {
        console.error('[AuctionWin] Error creating auction win file:', error);
        throw error;
      } finally {
        await this.disconnect();
      }
    });
  }

  /**
   * Format auction data as JSON for Lua parsing
   * @param {object} auctionData - Complete auction data object
   * @returns {string} - JSON string for the auction win data
   */
  formatAuctionWinDataAsJSON(auctionData) {
    // Parse JSON data if it exists
    let parsedModData = null;
    let parsedItemData = null;
    let parsedOriginalSource = null;

    try {
      if (auctionData.moddata) {
        parsedModData = JSON.parse(auctionData.moddata);
      }
    } catch (e) {
      console.warn('[AuctionWin] Failed to parse moddata for JSON:', e);
      parsedModData = { raw: auctionData.moddata };
    }

    try {
      if (auctionData.itemdata) {
        parsedItemData = JSON.parse(auctionData.itemdata);
      }
    } catch (e) {
      console.warn('[AuctionWin] Failed to parse itemdata for JSON:', e);
      parsedItemData = { raw: auctionData.itemdata };
    }

    try {
      if (auctionData.originalsource) {
        parsedOriginalSource = JSON.parse(auctionData.originalsource);
      }
    } catch (e) {
      console.warn('[AuctionWin] Failed to parse originalsource for JSON:', e);
      parsedOriginalSource = { raw: auctionData.originalsource };
    }

    // Create structured JSON object optimized for Lua parsing
    const auctionWinData = {
      auctionInfo: {
        auctionID: auctionData.itemid,
        itemName: auctionData.itemname,
        itemDescription: auctionData.itemdesc || null,
        itemType: auctionData.itemtype || 'Unknown',
        itemCondition: auctionData.itemcondition || 'Unknown',
        startingPrice: auctionData.itemprice || 0,
        finalBid: auctionData.lastbid || 0,
        buyoutPrice: auctionData.buyoutprice || null,
        status: auctionData.status || 'completed'
      },
      sellerInfo: {
        sellerID: auctionData.sellerid,
        sellerName: auctionData.sellername || null
      },
      winnerInfo: {
        buyerID: auctionData.buyerid,
        buyerName: auctionData.buyername || null,
        buyerUsername: auctionData.buyerUsername || null
      },
      timestamps: {
        createdAt: auctionData.createdAt,
        updatedAt: auctionData.updatedAt,
        fileGenerated: new Date().toISOString()
      },
      itemData: {
        modData: parsedModData,
        itemData: parsedItemData,
        originalSource: parsedOriginalSource
      },
      gameIntegration: {
        instructions: "Use itemData for complete item reconstruction, apply modData for properties/enchantments",
        restorationPriority: [
          "Use itemData.itemData for complete item reconstruction",
          "Apply itemData.modData for custom properties and enchantments",
          `Set item condition to: ${auctionData.itemcondition || '1.0'}`,
          `Verify item type matches: ${auctionData.itemtype || 'Base.Unknown'}`
        ]
      },
      metadata: {
        version: "1.0",
        format: "json",
        luaCompatible: true
      }
    };

    // Return formatted JSON with proper indentation for readability
    return JSON.stringify(auctionWinData, null, 2);
  }

  /**
   * Format auction data for auction win file with complete item information (legacy text format)
   * @param {object} auctionData - Complete auction data object
   * @returns {string} - Formatted file content with full item data
   */
  formatAuctionWinData(auctionData) {
    const timestamp = new Date().toISOString();

    // Parse JSON data if it exists
    let parsedModData = null;
    let parsedItemData = null;
    let parsedOriginalSource = null;

    try {
      if (auctionData.moddata) {
        parsedModData = JSON.parse(auctionData.moddata);
      }
    } catch (e) {
      console.warn('[AuctionWin] Failed to parse moddata:', e);
    }

    try {
      if (auctionData.itemdata) {
        parsedItemData = JSON.parse(auctionData.itemdata);
      }
    } catch (e) {
      console.warn('[AuctionWin] Failed to parse itemdata:', e);
    }

    try {
      if (auctionData.originalsource) {
        parsedOriginalSource = JSON.parse(auctionData.originalsource);
      }
    } catch (e) {
      console.warn('[AuctionWin] Failed to parse originalsource:', e);
    }

    // Build comprehensive auction win file
    let content = `AUCTION WIN RECORD
Generated: ${timestamp}
================================

BASIC AUCTION INFORMATION:
Auction ID: ${auctionData.itemid}
Item Name: ${auctionData.itemname}
Item Description: ${auctionData.itemdesc || 'No description'}
Item Type: ${auctionData.itemtype || 'Unknown'}
Item Condition: ${auctionData.itemcondition || 'Unknown'}
Starting Price: ${auctionData.itemprice} points
Final Bid: ${auctionData.lastbid} points
Buyout Price: ${auctionData.buyoutprice || 'Not set'} points
Status: ${auctionData.status}

SELLER INFORMATION:
- Seller ID: ${auctionData.sellerid}
- Seller Name: ${auctionData.sellername || 'Unknown'}

WINNER INFORMATION:
- Buyer ID: ${auctionData.buyerid}
- Buyer Name: ${auctionData.buyername || 'Unknown'}
- Buyer Username: ${auctionData.buyerUsername || 'Unknown'}

AUCTION TIMESTAMPS:
- Created: ${auctionData.createdAt}
- Last Updated: ${auctionData.updatedAt}

================================
COMPLETE ITEM DATA SECTION:
================================

`;

    // Add MOD DATA section if available
    if (parsedModData) {
      content += `MOD DATA:
${JSON.stringify(parsedModData, null, 2)}

`;
    } else if (auctionData.moddata) {
      content += `MOD DATA (Raw):
${auctionData.moddata}

`;
    } else {
      content += `MOD DATA:
No mod data available

`;
    }

    // Add ITEM DATA section if available
    if (parsedItemData) {
      content += `ITEM DATA:
${JSON.stringify(parsedItemData, null, 2)}

`;
    } else if (auctionData.itemdata) {
      content += `ITEM DATA (Raw):
${auctionData.itemdata}

`;
    } else {
      content += `ITEM DATA:
No item data available

`;
    }

    // Add ORIGINAL SOURCE section if available
    if (parsedOriginalSource) {
      content += `ORIGINAL LOG BRIDGE DATA:
${JSON.stringify(parsedOriginalSource, null, 2)}

`;
    } else if (auctionData.originalsource) {
      content += `ORIGINAL LOG BRIDGE DATA (Raw):
${auctionData.originalsource}

`;
    } else {
      content += `ORIGINAL LOG BRIDGE DATA:
No original source data available

`;
    }

    content += `================================
GAME INTEGRATION INSTRUCTIONS:
================================

This file contains complete item data for restoration.
The game should use the ITEM DATA and MOD DATA sections
to recreate the exact item with all properties, enchantments,
conditions, and modifications intact.

Item Restoration Priority:
1. Use ITEM DATA for complete item reconstruction
2. Apply MOD DATA for custom properties and enchantments
3. Set item condition to: ${auctionData.itemcondition || '1.0'}
4. Verify item type matches: ${auctionData.itemtype || 'Base.Unknown'}

================================
End of Auction Win Record`;

    return content;
  }
}
