'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('flea_market_listings', {
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true
      },
      seller: {
        type: Sequelize.STRING(128),
        allowNull: false
      },
      buyer: {
        type: Sequelize.STRING(128),
        allowNull: true
      },
      item_type: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      display_name: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      qty: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      price: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      total: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      created_at_unix: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      expires_at_unix: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      sold_at_unix: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      expired_at_unix: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      redeemed_at_unix: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'active'
      },
      transaction_fee: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      listing_fee: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      last_buyer: {
        type: Sequelize.STRING(128),
        allowNull: true
      },
      last_buy_at_unix: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      admin_cancelled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      admin_cancelled_by: {
        type: Sequelize.STRING(128),
        allowNull: true
      },
      item_data: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      item_meta: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      script_stats: {
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

    await queryInterface.addIndex('flea_market_listings', ['seller'], {
      name: 'flea_market_listings_seller_idx'
    });

    await queryInterface.addIndex('flea_market_listings', ['status'], {
      name: 'flea_market_listings_status_idx'
    });

    await queryInterface.addIndex('flea_market_listings', ['item_type'], {
      name: 'flea_market_listings_item_type_idx'
    });

    await queryInterface.addIndex('flea_market_listings', ['created_at_unix'], {
      name: 'flea_market_listings_created_at_unix_idx'
    });

    await queryInterface.createTable('flea_market_accounts', {
      username: {
        type: Sequelize.STRING(128),
        allowNull: false,
        primaryKey: true
      },
      pending: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      sales: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
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

    await queryInterface.addIndex('flea_market_accounts', ['pending'], {
      name: 'flea_market_accounts_pending_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('flea_market_accounts', 'flea_market_accounts_pending_idx');
    await queryInterface.dropTable('flea_market_accounts');

    await queryInterface.removeIndex('flea_market_listings', 'flea_market_listings_created_at_unix_idx');
    await queryInterface.removeIndex('flea_market_listings', 'flea_market_listings_item_type_idx');
    await queryInterface.removeIndex('flea_market_listings', 'flea_market_listings_status_idx');
    await queryInterface.removeIndex('flea_market_listings', 'flea_market_listings_seller_idx');
    await queryInterface.dropTable('flea_market_listings');
  }
};

