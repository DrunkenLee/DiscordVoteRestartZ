'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('zmusers', {
      userid: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      discordid: {
        type: Sequelize.STRING,
        allowNull: true
      },
      steamid: {
        type: Sequelize.STRING,
        allowNull: true
      },
      ownerid: {
        type: Sequelize.STRING,
        allowNull: true
      },
      username1: {
        type: Sequelize.STRING,
        allowNull: true
      },
      password1: {
        type: Sequelize.STRING,
        allowNull: true
      },
      username2: {
        type: Sequelize.STRING,
        allowNull: true
      },
      password2: {
        type: Sequelize.STRING,
        allowNull: true
      },
      extradata: {
        type: Sequelize.JSONB,
        allowNull: true
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
    await queryInterface.dropTable('zmusers');
  }
};
