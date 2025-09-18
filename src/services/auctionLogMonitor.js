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

    // Always start from position 0 (we don't persist offsets)
    this.currentPosition = 0;
    logger.info(`[AuctionLogMonitor] Starting from position: ${this.currentPosition}`);

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
      // Always scan from position 0
      const result = await this.sftpLogReader.scanForAuctionLogs(0);

      if (!result.success) {
        logger.error('[AuctionLogMonitor] Failed to scan auction logs:', result.error);
        return;
      }

      if (result.auctionEntries && result.auctionEntries.length > 0) {
        logger.info(`[AuctionLogMonitor] Found ${result.auctionEntries.length} new auction entries`);

        let allSucceeded = true;
        for (const entry of result.auctionEntries) {
          const ok = await this.processAuctionEntry(entry);
          if (!ok) allSucceeded = false;
        }

        if (allSucceeded) {
          try {
            await this.sftpLogReader.truncateAuctionLogFile();
            this.currentPosition = 0;
            logger.info('[AuctionLogMonitor] Successfully processed all entries; auction log truncated.');
          } catch (truncateError) {
            logger.error('[AuctionLogMonitor] Failed to truncate auction log after processing:', truncateError);
            // Keep position at 0 to retry on next cycle
            this.currentPosition = 0;
          }
        } else {
          // Some entries failed; keep position at 0 to retry next cycle
          this.currentPosition = 0;
          logger.warn('[AuctionLogMonitor] Some entries failed; auction log preserved for retry.');
        }
      } else {
        // No entries; keep position at 0
        this.currentPosition = 0;
      }

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
          return true;

        case 'PLACE_BID':
          await this.handlePlaceBid(data, timestamp, unixTime);
          return true;

        case 'BUYOUT':
          await this.handleBuyout(data, timestamp, unixTime);
          return true;

        case 'AUCTION_EXPIRED':
          await this.handleAuctionExpired(data, timestamp, unixTime);
          return true;

        case 'SYSTEM_TEST':
          logger.info('[AuctionLogMonitor] System test entry received:', data);
          return true;

        default:
          logger.warn(`[AuctionLogMonitor] Unknown auction action: ${action}`);
          return false;
      }

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error processing auction entry:', error);
      logger.error('[AuctionLogMonitor] Failed entry data:', JSON.stringify(entry, null, 2));
      return false;
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

      // Transform auction data to match database schema with enhanced item information
      const auctionData = {
        sellerid: seller.id,
        itemname: data.itemName || data.itemType,
        itemdesc: this.buildItemDescription(data),
        itemtype: data.itemType || null,
        itemcondition: data.condition ? parseFloat(data.condition) / 100 : null, // Convert percentage to decimal (50 -> 0.50)
        itemprice: parseFloat(data.startingPrice) || 0,
        lastbid: parseFloat(data.currentBid) || parseFloat(data.startingPrice) || 0,
        buyoutprice: data.buyoutPrice ? parseFloat(data.buyoutPrice) : null,
        sellername: seller.username1 || data.sellerUsername || null,
        status: data.isActive ? 'active' : 'inactive',
        // Store complete item data as JSON strings
        moddata: data.modData ? JSON.stringify(data.modData) : null,
        itemdata: data.fullItemData ? JSON.stringify(data.fullItemData) :
                  data.itemProperties ? JSON.stringify({
                    itemType: data.itemType,
                    condition: data.condition,
                    weight: data.weight,
                    properties: data.itemProperties,
                    category: data.category,
                    description: data.description,
                    customName: data.customName
                  }) :
                  JSON.stringify({
                    itemType: data.itemType,
                    itemID: data.itemID,
                    itemName: data.itemName,
                    customName: data.customName,
                    condition: data.condition,
                    weight: data.weight,
                    category: data.category,
                    description: data.description,
                    tooltip: data.tooltip,
                    enchantmentLevel: data.enchantmentLevel,
                    hasDamageBoost: data.hasDamageBoost,
                    enchantMaxDamage: data.enchantMaxDamage,
                    enchantMinDamage: data.enchantMinDamage,
                    originalMaxDamage: data.originalMaxDamage,
                    originalMinDamage: data.originalMinDamage
                  }),
        // Store original log entry for complete traceability
        originalsource: JSON.stringify({
          action: 'CREATE_AUCTION',
          timestamp: timestamp,
          unixTime: unixTime,
          data: data
        })
      };

      // Create auction in database
      const auction = await PlayerAuction.create(auctionData);

      logger.info(`[AuctionLogMonitor] ✅ Created auction #${auction.itemid}: ${auctionData.itemname} by ${data.sellerUsername}`);

      // Send notification to auction channel (detailed fields)
      await this.sendAuctionNotificationDetailed(auction, seller, data, { timestamp, unixTime });

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

      // Update auction with new bid and buyer information
      await auction.update({
        lastbid: parseFloat(data.bidAmount),
        buyername: bidder.username1 || data.bidderUsername || null,
        buyerid: bidder.id || null,
        buyerUsername: bidder.username1 || null
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

      // Update auction status to completed with buyer information
      await auction.update({
        lastbid: parseFloat(data.buyoutPrice),
        buyername: buyer.username1 || data.buyerUsername || null,
        buyerid: buyer.id || null,
        buyerUsername: buyer.username1 || null,
        status: 'completed'
      });

      // Create auction win file with complete item data
      try {
        await this.sftpLogReader.createAuctionWinFile(buyer.username1, auction.toJSON());
        logger.info(`[AuctionLogMonitor] Created win file for ${buyer.username1} - Auction #${auction.itemid} (Log Bridge Buyout)`);
      } catch (fileError) {
        logger.error('[AuctionLogMonitor] Error creating win file for log bridge buyout:', fileError);
      }

      logger.info(`[AuctionLogMonitor] ✅ Buyout completed for auction #${auction.itemid}: ${data.buyoutPrice} by ${data.buyerUsername}`);

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error handling BUYOUT:', error);
      throw error;
    }
  }

  /**
   * Handle AUCTION_EXPIRED action
   * @param {Object} data - Auction expiry data
   * @param {string} timestamp - ISO timestamp
   * @param {number} unixTime - Unix timestamp
   */
  async handleAuctionExpired(data, timestamp, unixTime) {
    try {
      // Find auction by itemID
      const auction = await PlayerAuction.findOne({
        where: { itemid: data.auctionID },
        include: [{
          model: ZMUser,
          as: 'seller',
          attributes: ['username1', 'steamid']
        }]
      });

      if (!auction) {
        logger.warn(`[AuctionLogMonitor] Auction not found for expiry: ${data.auctionID}`);
        return;
      }

      // Check if auction had a winner (highest bidder)
      if (data.winnerSteamID && data.winnerUsername) {
        // Ensure Steam ID is a string for database compatibility
        const winnerSteamIdString = String(data.winnerSteamID);

        // Find or create winner
        const [winner, created] = await ZMUser.findOrCreate({
          where: { steamid: winnerSteamIdString },
          defaults: {
            username1: data.winnerUsername,
            steamid: winnerSteamIdString
          }
        });

        if (created) {
          logger.info(`[AuctionLogMonitor] Created new ZMUser for winner: ${data.winnerUsername}`);
        }

        // Update auction status to completed with winner information
        await auction.update({
          lastbid: parseFloat(data.finalBid || auction.lastbid),
          buyername: winner.username1 || data.winnerUsername || null,
          buyerid: winner.id || null,
          buyerUsername: winner.username1 || null,
          status: 'completed'
        });

        // Create auction win file for the winner
        try {
          await this.sftpLogReader.createAuctionWinFile(winner.username1, auction.toJSON());
          logger.info(`[AuctionLogMonitor] Created win file for winner ${winner.username1} - Auction #${auction.itemid} (Log Bridge Expired with winner)`);
        } catch (fileError) {
          logger.error('[AuctionLogMonitor] Error creating win file for expired auction winner:', fileError);
        }

      } else {
        // No winner, return item to seller
        await auction.update({ status: 'expired' });

        // Create auction win file to return item to seller
        try {
          const seller = auction.seller;
          const sellerUsername = seller?.username1 || data.sellerUsername || 'Unknown';

          await this.sftpLogReader.createAuctionWinFile(sellerUsername, auction.toJSON());
          logger.info(`[AuctionLogMonitor] Created win file to return item to seller ${sellerUsername} - Auction #${auction.itemid} (Log Bridge Expired with no winner)`);
        } catch (fileError) {
          logger.error('[AuctionLogMonitor] Error creating win file for expired auction return:', fileError);
        }
      }

      logger.info(`[AuctionLogMonitor] ✅ Processed expired auction #${auction.itemid}: ${data.winnerUsername ? 'Winner: ' + data.winnerUsername : 'Returned to seller'}`);

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error handling AUCTION_EXPIRED:', error);
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
    if (data.condition !== undefined) {
      // Condition is already in percentage format (0-100), don't multiply by 100
      const conditionPercent = parseFloat(data.condition).toFixed(1);
      parts.push(`Condition: ${conditionPercent}%`);
    }
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
  async sendAuctionNotificationDetailed(auction, seller, data, meta = {}) {
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

      // Map fields for the firearms weapon example
      const pad2 = (n) => String(n).padStart(2, '0');
      const fmt2 = (v) => (v !== undefined && v !== null && isFinite(Number(v)) ? Number(v).toFixed(2) : 'N/A');
      const sellerUsername = data?.sellerUsername || seller?.username1 || 'Unknown';
      const itemName = data?.itemName || auction.itemname || 'Unknown';
      const itemType = data?.itemType || 'Unknown';
      const recoil = data?.modData?.IPPJRecoilDelay != null ? String(data.modData.IPPJRecoilDelay) : 'N/A';
      const boundedMysticOrb = (data?.hasDamageBoost ?? data?.modData?.hasDamageBoost) != null
        ? String(data.hasDamageBoost ?? data.modData.hasDamageBoost)
        : 'N/A';
      const originalMinDamage = fmt2(data?.modData?.origMinDamage);
      const originalMaxDamage = fmt2(data?.modData?.origMaxDamage);
      const enchantMinDamage = fmt2(data?.enchantMinDamage);
      const enchantMaxDamage = fmt2(data?.enchantMaxDamage);
      const itemID = data?.itemID != null ? String(data.itemID) : 'N/A';
      const condition = data?.condition != null ? String(data.condition) : 'N/A';
      const category = data?.category || 'N/A';
      const startingPrice = Number.isFinite(Number(data?.startingPrice)) ? `${Number(data.startingPrice)} points` : 'N/A';
      const buyoutPrice = Number.isFinite(Number(data?.buyoutPrice)) ? `${Number(data.buyoutPrice)} points` : '—';
      const currentBidVal = Number.isFinite(Number(data?.currentBid)) ? Number(data.currentBid) : 0;
      const buyoutPriceSafe = Number.isFinite(Number(data?.buyoutPrice)) ? `${Number(data.buyoutPrice)} points` : '-';
      const currentBid = `${currentBidVal} points`;
      const duration = data?.duration != null ? `${data.duration} hours` : 'N/A';
      const d = meta?.timestamp ? new Date(meta.timestamp) : (typeof data?.timestamp === 'number' ? new Date(data.timestamp * 1000) : null);
      const logTimestamp = d ? `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : 'N/A';

      // Build fields dynamically based on category
      const fields = [
        { name: 'timestamp', value: String(logTimestamp), inline: false },
        { name: 'sellerUsername', value: sellerUsername, inline: true },
        { name: 'itemName', value: itemName, inline: true },
        { name: 'itemType', value: itemType, inline: true },
        { name: 'itemID', value: itemID, inline: true },
        { name: 'category', value: category, inline: true },
        { name: 'condition', value: condition, inline: true }
      ];

      if (category === 'Weapon') {
        if (recoil != null) fields.push({ name: 'recoil', value: String(recoil), inline: true });
        if (boundedMysticOrb != null) fields.push({ name: 'boundedMysticOrb', value: String(boundedMysticOrb), inline: true });
        fields.push(
          { name: 'originalMinDamage', value: originalMinDamage, inline: true },
          { name: 'originalMaxDamage', value: originalMaxDamage, inline: true },
          { name: 'enchantMinDamage', value: enchantMinDamage, inline: true },
          { name: 'enchantMaxDamage', value: enchantMaxDamage, inline: true }
        );
      } else {
        const cv = data?.modData?.BootRefine?.currentValues;
        const weight = data?.weight != null ? (Number.isFinite(Number(data.weight)) ? Number(data.weight).toFixed(2) : String(data.weight)) : 'N/A';
        fields.push(
          { name: 'weight', value: weight, inline: true },
          { name: 'server', value: data?.serverName || 'N/A', inline: true },
          { name: 'customName', value: data?.customName || '—', inline: true }
        );
        if (data?.description && String(data.description).trim().length) {
          fields.push({ name: 'description', value: String(data.description), inline: false });
        }
        if (cv) {
          if (cv.ScratchDefense != null) fields.push({ name: 'ScratchDefense', value: String(cv.ScratchDefense), inline: true });
          if (cv.BiteDefense != null) fields.push({ name: 'BiteDefense', value: String(cv.BiteDefense), inline: true });
          if (cv.BulletDefense != null) fields.push({ name: 'BulletDefense', value: String(cv.BulletDefense), inline: true });
          if (cv.CombatSpeedMod != null) fields.push({ name: 'CombatSpeedMod', value: (Number.isFinite(Number(cv.CombatSpeedMod)) ? Number(cv.CombatSpeedMod).toFixed(2) : String(cv.CombatSpeedMod)), inline: true });
        }
      }

      // Pricing and duration
      fields.push(
        { name: 'startingPrice', value: startingPrice, inline: false },
        { name: 'buyoutPrice', value: buyoutPrice, inline: false },
        { name: 'initialBid', value: currentBid, inline: false },
        { name: 'duration', value: duration, inline: false }
      );

      const embed = new EmbedBuilder()
        .setTitle('New Auction Listed!')
        .setColor(0x00ff00)
        .addFields(fields)
        .setTimestamp()
        .setFooter({ text: 'New auctions are automatically posted from the game server' });

      // Create button components
      const buttons = [];

      // Auto bid button
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`bidv2_${auction.itemid}`)
          .setLabel('Auto Bid')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('💰')
      );

      // Manual bid button
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`manualbid_${auction.itemid}`)
          .setLabel('Manual Bid')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✏️')
      );

      // Buyout button (only if buyout price is set)
      if (Number.isFinite(Number(data?.buyoutPrice)) && Number(data.buyoutPrice) > 0) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`buyout_${auction.itemid}`)
            .setLabel(`Buyout ${Number(data.buyoutPrice)} pts`)
            .setStyle(ButtonStyle.Success)
            .setEmoji('🚀')
        );
      }

      const actionRow = new ActionRowBuilder().addComponents(buttons);

      const sentMessage = await auctionChannel.send({ embeds: [embed], components: [actionRow] });

      // Store the Discord message ID in the auction record for later deletion
      try {
        await auction.update({ discordMessageId: sentMessage.id });
        logger.info(`[AuctionLogMonitor] Stored Discord message ID ${sentMessage.id} for auction #${auction.itemid}`);
      } catch (updateError) {
        logger.warn(`[AuctionLogMonitor] Failed to store Discord message ID for auction #${auction.itemid}:`, updateError);
      }

      logger.info(`[AuctionLogMonitor] Sent auction notification for item: ${auction.itemname}`);

    } catch (error) {
      logger.error('[AuctionLogMonitor] Error sending auction notification:', error);
    }
  }
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

