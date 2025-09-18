'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('player_auctions', 'buyoutprice', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
      comment: 'Buyout price for instant purchase - if null, no buyout available'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('player_auctions', 'buyoutprice');
  }
};