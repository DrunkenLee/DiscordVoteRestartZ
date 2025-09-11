import { SftpLogReader } from '../utils/sftpLogReader.js';
import { PlayerAuction } from '../models/playerAuction.js';
import { ZMUser } from '../models/zmuser.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export class AuctionLogMonitor {
  constructor(discordClient = null) {
    this.sftpLogReader = new SftpLogReader();
    this.isRunning = false;
    this.currentPosition = 0;
    this.intervalId = null;
    this.scanInterval = 30000; // 30 seconds
    this.discordClient = discordClient;
  }

  /**
   * Start monitoring auction logs
   */
  async start() {
    if (this.isRunning) {
      logger.info('[AuctionLogMonitor] Already running');
      return;
    }

    logger.info('[AuctionLogMonitor] Starting auction log monitoring...');
    this.isRunning = true;

    // Get initial file position
    try {
      this.currentPosition = await this.sftpLogReader.getAuctionLogFileSize();
      logger.info(`[AuctionLogMonitor] Starting from position: ${this.currentPosition}`);
    } catch (error) {
      logger.error('[AuctionLogMonitor] Error getting initial file position:', error);
      this.currentPosition = 0;
    }

    // Start periodic scanning
    this.intervalId = setInterval(async () => {
      await this.scanAndProcessAuctions();
    }, this.scanInterval);

    logger.info(`[AuctionLogMonitor] Monitoring started with ${this.scanInterval/1000}s interval`);
  }

  /**
   * Stop monitoring auction logs
   */
  stop() {
    if (!this.isRunning) {
      logger.info('[AuctionLogMonitor] Not running');
      return;
    }

    logger.info('[AuctionLogMonitor] Stopping auction log monitoring...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('[AuctionLogMonitor] Monitoring stopped');
  }

  /**
   * Scan for new auction entries and process them
   */
  async scanAndProcessAuctions() {
    try {
      const result = await this.sftpLogReader.scanForAuctionLogs(this.currentPosition);

      if (!result.success) {
        logger.error('[AuctionLogMonitor] Failed to scan auction logs:', result.error);
        return;
      }

      if (result.auctionEntries && result.auctionEntries.length > 0) {
        logger.info(`[AuctionLogMonitor] Found ${result.auctionEntries.length} new auction entries`);

        for (const entry of result.auctionEntries) {
          await this.processAuctionEntry(entry);
        }
      }

      // Update position for next scan
      this.currentPosition = result.newPosition;

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error during scan and process:', error);
    }
  }

  /**
   * Process individual auction entry based on action type
   * @param {Object} entry - Auction log entry
   */
  async processAuctionEntry(entry) {
    try {
      const { action, timestamp, unixTime, data } = entry;

      logger.info(`[AuctionLogMonitor] Processing ${action} at ${timestamp}`);

      switch (action) {
        case 'CREATE_AUCTION':
          await this.handleCreateAuction(data, timestamp, unixTime);
          break;

        case 'PLACE_BID':
          await this.handlePlaceBid(data, timestamp, unixTime);
          break;

        case 'BUYOUT':
          await this.handleBuyout(data, timestamp, unixTime);
          break;

        case 'SYSTEM_TEST':
          logger.info('[AuctionLogMonitor] System test entry received:', data);
          break;

        default:
          logger.warn(`[AuctionLogMonitor] Unknown auction action: ${action}`);
      }

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error processing auction entry:', error);
      logger.error('[AuctionLogMonitor] Entry data:', entry);
    }
  }

  /**
   * Handle CREATE_AUCTION action
   * @param {Object} data - Auction data
   * @param {string} timestamp - ISO timestamp
   * @param {number} unixTime - Unix timestamp
   */
  async handleCreateAuction(data, timestamp, unixTime) {
    try {
      // Ensure Steam ID is a string for database compatibility
      const steamIdString = String(data.sellerSteamID);

      // Find or create seller in ZMUser table
      const [seller, created] = await ZMUser.findOrCreate({
        where: { steamid: steamIdString },
        defaults: {
          username1: data.sellerUsername, // Use username1 field as per schema
          steamid: steamIdString
        }
      });

      if (created) {
        logger.info(`[AuctionLogMonitor] Created new ZMUser: ${data.sellerUsername}`);
      }

      // Transform auction data to match database schema
      const auctionData = {
        sellerid: seller.id,
        itemname: data.itemName || data.itemType,
        itemdesc: this.buildItemDescription(data),
        itemprice: parseFloat(data.startingPrice) || 0,
        lastbid: parseFloat(data.currentBid) || parseFloat(data.startingPrice) || 0,
        status: data.isActive ? 'active' : 'inactive'
      };

      // Create auction in database
      const auction = await PlayerAuction.create(auctionData);

      logger.info(`[AuctionLogMonitor] ✅ Created auction #${auction.itemid}: ${auctionData.itemname} by ${data.sellerUsername}`);

      // Send notification to auction channel
      await this.sendAuctionNotification(auction, seller, data);

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error handling CREATE_AUCTION:', error);
      throw error;
    }
  }

  /**
   * Handle PLACE_BID action
   * @param {Object} data - Bid data
   * @param {string} timestamp - ISO timestamp
   * @param {number} unixTime - Unix timestamp
   */
  async handlePlaceBid(data, timestamp, unixTime) {
    try {
      // Find auction by itemID (this might need adjustment based on your ID mapping)
      const auction = await PlayerAuction.findOne({
        where: { itemid: data.auctionID }
      });

      if (!auction) {
        logger.warn(`[AuctionLogMonitor] Auction not found for bid: ${data.auctionID}`);
        return;
      }

      // Ensure Steam ID is a string for database compatibility
      const bidderSteamIdString = String(data.bidderSteamID);

      // Find or create bidder
      const [bidder, created] = await ZMUser.findOrCreate({
        where: { steamid: bidderSteamIdString },
        defaults: {
          username1: data.bidderUsername, // Use username1 field as per schema
          steamid: bidderSteamIdString
        }
      });

      if (created) {
        logger.info(`[AuctionLogMonitor] Created new ZMUser: ${data.bidderUsername}`);
      }

      // Update auction with new bid
      await auction.update({
        lastbid: parseFloat(data.bidAmount)
      });

      logger.info(`[AuctionLogMonitor] ✅ Updated bid for auction #${auction.itemid}: ${data.bidAmount} by ${data.bidderUsername}`);

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error handling PLACE_BID:', error);
      throw error;
    }
  }

  /**
   * Handle BUYOUT action
   * @param {Object} data - Buyout data
   * @param {string} timestamp - ISO timestamp
   * @param {number} unixTime - Unix timestamp
   */
  async handleBuyout(data, timestamp, unixTime) {
    try {
      // Find auction by itemID
      const auction = await PlayerAuction.findOne({
        where: { itemid: data.auctionID }
      });

      if (!auction) {
        logger.warn(`[AuctionLogMonitor] Auction not found for buyout: ${data.auctionID}`);
        return;
      }

      // Ensure Steam ID is a string for database compatibility
      const buyerSteamIdString = String(data.buyerSteamID);

      // Find or create buyer
      const [buyer, created] = await ZMUser.findOrCreate({
        where: { steamid: buyerSteamIdString },
        defaults: {
          username1: data.buyerUsername, // Use username1 field as per schema
          steamid: buyerSteamIdString
        }
      });

      if (created) {
        logger.info(`[AuctionLogMonitor] Created new ZMUser: ${data.buyerUsername}`);
      }

      // Update auction status to sold/completed
      await auction.update({
        lastbid: parseFloat(data.buyoutPrice),
        status: 'sold'
      });

      logger.info(`[AuctionLogMonitor] ✅ Buyout completed for auction #${auction.itemid}: ${data.buyoutPrice} by ${data.buyerUsername}`);

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error handling BUYOUT:', error);
      throw error;
    }
  }

  /**
   * Build item description from auction data
   * @param {Object} data - Auction data
   * @returns {string} - Formatted item description
   */
  buildItemDescription(data) {
    const parts = [];

    if (data.itemType) parts.push(`Type: ${data.itemType}`);
    if (data.condition !== undefined) parts.push(`Condition: ${(data.condition * 100).toFixed(1)}%`);
    if (data.buyoutPrice) parts.push(`Buyout: ${data.buyoutPrice}`);
    if (data.duration) parts.push(`Duration: ${data.duration}h`);
    if (data.serverName) parts.push(`Server: ${data.serverName}`);

    return parts.join(' | ');
  }

  /**
   * Get monitoring status
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentPosition: this.currentPosition,
      scanInterval: this.scanInterval,
      intervalId: this.intervalId !== null
    };
  }

  /**
   * Manual scan for testing purposes
   */
  async manualScan() {
    logger.info('[AuctionLogMonitor] Manual scan requested');
    await this.scanAndProcessAuctions();
  }

  /**
   * Send auction notification to Discord auction channel
   * @param {Object} auction - Created auction object
   * @param {Object} seller - Seller user object
   * @param {Object} data - Original auction data
   */
  async sendAuctionNotification(auction, seller, data) {
    try {
      if (!this.discordClient) {
        logger.warn('[AuctionLogMonitor] Discord client not available for notifications');
        return;
      }

      const auctionChannelId = config.get('discord.auctionChannelId');
      if (!auctionChannelId) {
        logger.warn('[AuctionLogMonitor] Auction channel ID not configured');
        return;
      }

      const auctionChannel = this.discordClient.channels.cache.get(auctionChannelId);
      if (!auctionChannel) {
        logger.warn(`[AuctionLogMonitor] Auction channel not found: ${auctionChannelId}`);
        return;
      }

      // Create notification embed
      const embed = new EmbedBuilder()
        .setTitle('🆕 New Auction Listed!')
        .setColor(0x00ff00)
        .addFields([
          { name: '📦 Item', value: auction.itemname, inline: true },
          { name: '💰 Starting Price', value: `${auction.itemprice} points`, inline: true },
          { name: '👤 Seller', value: seller.username1 || 'Unknown', inline: true },
          { name: '💎 Current Bid', value: `${auction.lastbid} points`, inline: true },
          { name: '🆔 Auction ID', value: `#${auction.itemid}`, inline: true },
          { name: '📝 Description', value: auction.itemdesc || 'No description', inline: false }
        ])
        .setTimestamp()
        .setFooter({ text: 'Use !auctionlist to see all active auctions' });

      // Add server info if available
      if (data.serverName) {
        embed.addFields({ name: '🖥️ Server', value: data.serverName, inline: true });
      }

      // Create bid button
      const bidButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`bid_${auction.itemid}`)
            .setLabel('Place Bid')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💰')
        );

      await auctionChannel.send({
        embeds: [embed],
        components: [bidButton]
      });

      logger.info(`[AuctionLogMonitor] ✅ Sent auction notification for item: ${auction.itemname}`);

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error sending auction notification:', error);
    }
  }
}
