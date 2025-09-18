/**
 * Migration to add discordMessageId field to player_auctions table
 * This will allow tracking Discord messages for auction notifications
 */

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('player_auctions', 'discordMessageId', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Discord message ID for the auction notification message'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('player_auctions', 'discordMessageId');
  }
};