'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('admin_clock_sessions', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      discordUserId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      discordUsername: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      discordDisplayName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      guildId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      clockInChannelId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      clockOutChannelId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      workDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      clockInAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      clockOutAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      durationMinutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('admin_clock_sessions', ['discordUserId'], {
      name: 'admin_clock_sessions_discord_user_idx',
    });

    await queryInterface.addIndex('admin_clock_sessions', ['workDate'], {
      name: 'admin_clock_sessions_work_date_idx',
    });

    await queryInterface.addIndex('admin_clock_sessions', ['clockOutAt'], {
      name: 'admin_clock_sessions_clock_out_idx',
    });

    await queryInterface.addIndex('admin_clock_sessions', ['discordUserId'], {
      name: 'admin_clock_sessions_open_session_unique',
      unique: true,
      where: {
        clockOutAt: null,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('admin_clock_sessions', 'admin_clock_sessions_open_session_unique');
    await queryInterface.removeIndex('admin_clock_sessions', 'admin_clock_sessions_clock_out_idx');
    await queryInterface.removeIndex('admin_clock_sessions', 'admin_clock_sessions_work_date_idx');
    await queryInterface.removeIndex('admin_clock_sessions', 'admin_clock_sessions_discord_user_idx');
    await queryInterface.dropTable('admin_clock_sessions');
  },
};
