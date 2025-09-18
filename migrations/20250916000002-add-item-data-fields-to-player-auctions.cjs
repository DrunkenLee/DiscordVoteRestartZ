'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('player_auctions', 'itemtype', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Full item type/class from game (e.g., Base.BaseballBat)'
    });

    await queryInterface.addColumn('player_auctions', 'itemcondition', {
      type: Sequelize.DECIMAL(3, 2),
      allowNull: true,
      comment: 'Item condition (0.0 to 1.0)'
    });

    await queryInterface.addColumn('player_auctions', 'moddata', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'JSON string containing item mod data and properties'
    });

    await queryInterface.addColumn('player_auctions', 'itemdata', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'JSON string containing complete item data from game'
    });

    await queryInterface.addColumn('player_auctions', 'originalsource', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Original source data from auction log bridge'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('player_auctions', 'itemtype');
    await queryInterface.removeColumn('player_auctions', 'itemcondition');
    await queryInterface.removeColumn('player_auctions', 'moddata');
    await queryInterface.removeColumn('player_auctions', 'itemdata');
    await queryInterface.removeColumn('player_auctions', 'originalsource');
  }
};