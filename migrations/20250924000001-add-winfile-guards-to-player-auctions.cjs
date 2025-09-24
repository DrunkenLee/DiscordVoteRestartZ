'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('player_auctions', 'winnerWinFileCreated', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Whether a winner delivery win file has been created',
    });

    await queryInterface.addColumn('player_auctions', 'sellerReturnWinFileCreated', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Whether a seller-return win file has been created',
    });

    await queryInterface.addColumn('player_auctions', 'winFileCreatedAt', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Timestamp when the first win file was created',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('player_auctions', 'winnerWinFileCreated');
    await queryInterface.removeColumn('player_auctions', 'sellerReturnWinFileCreated');
    await queryInterface.removeColumn('player_auctions', 'winFileCreatedAt');
  }
};
