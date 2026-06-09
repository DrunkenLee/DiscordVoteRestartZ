'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('raid_point_topups', {
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true
      },
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
      username: {
        type: Sequelize.STRING(128),
        allowNull: false
      },
      raid_points: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      amount: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      idr_per_raid_point: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 2000
      },
      autogopay_transaction_id: {
        type: Sequelize.STRING(128),
        allowNull: false,
        unique: true
      },
      autogopay_order_id: {
        type: Sequelize.STRING(128),
        allowNull: true
      },
      autogopay_status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'pending'
      },
      payment_status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'pending'
      },
      credit_status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'pending'
      },
      gateway_message: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      qr_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      qr_string: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      transaction_time: {
        type: Sequelize.DATE,
        allowNull: true
      },
      expiry_time: {
        type: Sequelize.DATE,
        allowNull: true
      },
      paid_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      credited_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      last_status_checked_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      callback_verified: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      callback_event: {
        type: Sequelize.STRING(64),
        allowNull: true
      },
      callback_payload: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      gateway_payload: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      credit_error: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('raid_point_topups', ['user_id'], {
      name: 'raid_point_topups_user_id_idx'
    });

    await queryInterface.addIndex('raid_point_topups', ['username'], {
      name: 'raid_point_topups_username_idx'
    });

    await queryInterface.addIndex('raid_point_topups', ['payment_status'], {
      name: 'raid_point_topups_payment_status_idx'
    });

    await queryInterface.addIndex('raid_point_topups', ['autogopay_transaction_id'], {
      name: 'raid_point_topups_transaction_id_idx'
    });

    await queryInterface.addIndex('raid_point_topups', ['createdAt'], {
      name: 'raid_point_topups_created_at_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('raid_point_topups', 'raid_point_topups_created_at_idx');
    await queryInterface.removeIndex('raid_point_topups', 'raid_point_topups_transaction_id_idx');
    await queryInterface.removeIndex('raid_point_topups', 'raid_point_topups_payment_status_idx');
    await queryInterface.removeIndex('raid_point_topups', 'raid_point_topups_username_idx');
    await queryInterface.removeIndex('raid_point_topups', 'raid_point_topups_user_id_idx');
    await queryInterface.dropTable('raid_point_topups');
  }
};
