'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('player_auctions', 'sellername', {
      type: Sequelize.TEXT,
      allowNull: true,
      after: 'lastbid'
    });
    await queryInterface.addColumn('player_auctions', 'buyername', {
      type: Sequelize.TEXT,
      allowNull: true,
      after: 'sellername'
    });
    await queryInterface.addColumn('player_auctions', 'buyerid', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'buyername'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('player_auctions', 'buyerid');
    await queryInterface.removeColumn('player_auctions', 'buyername');
    await queryInterface.removeColumn('player_auctions', 'sellername');
  }
};