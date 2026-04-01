'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('virtual_garage_snapshots', {
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true
      },
      file_path: {
        type: Sequelize.STRING(512),
        allowNull: false,
        unique: true
      },
      owner_username: {
        type: Sequelize.STRING(128),
        allowNull: false
      },
      owner_steam_id: {
        type: Sequelize.STRING(64),
        allowNull: true
      },
      vehicle_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      vehicle_name: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      script_name: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'active'
      },
      snapshot: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      summary: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      saved_time: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      source_server: {
        type: Sequelize.STRING(128),
        allowNull: true
      },
      restored_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      deleted_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('virtual_garage_snapshots', ['owner_username'], {
      name: 'virtual_garage_owner_username_idx'
    });

    await queryInterface.addIndex('virtual_garage_snapshots', ['status'], {
      name: 'virtual_garage_status_idx'
    });

    await queryInterface.addIndex('virtual_garage_snapshots', ['vehicle_id'], {
      name: 'virtual_garage_vehicle_id_idx'
    });

    await queryInterface.addIndex('virtual_garage_snapshots', ['saved_time'], {
      name: 'virtual_garage_saved_time_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('virtual_garage_snapshots', 'virtual_garage_saved_time_idx');
    await queryInterface.removeIndex('virtual_garage_snapshots', 'virtual_garage_vehicle_id_idx');
    await queryInterface.removeIndex('virtual_garage_snapshots', 'virtual_garage_status_idx');
    await queryInterface.removeIndex('virtual_garage_snapshots', 'virtual_garage_owner_username_idx');
    await queryInterface.dropTable('virtual_garage_snapshots');
  }
};

