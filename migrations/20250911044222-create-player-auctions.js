'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('player_auctions', {
      itemid: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      sellerid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'zmusers',
          key: 'userid'
        }
      },
      itemname: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      itemdesc: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      itemprice: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      lastbid: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      status: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('player_auctions');
  }
};
