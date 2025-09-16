'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('player_auctions', 'buyerUsername', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
      after: 'buyerid'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('player_auctions', 'buyerUsername');
  }
};