import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const FleaMarketListing = sequelize.define('FleaMarketListing', {
  id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true
  },
  seller: {
    type: DataTypes.STRING(128),
    allowNull: false
  },
  buyer: {
    type: DataTypes.STRING(128),
    allowNull: true
  },
  itemType: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'item_type'
  },
  displayName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'display_name'
  },
  qty: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  price: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  createdAtUnix: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'created_at_unix'
  },
  expiresAtUnix: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'expires_at_unix'
  },
  soldAtUnix: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'sold_at_unix'
  },
  expiredAtUnix: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'expired_at_unix'
  },
  redeemedAtUnix: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'redeemed_at_unix'
  },
  status: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'active'
  },
  transactionFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'transaction_fee'
  },
  listingFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'listing_fee'
  },
  lastBuyer: {
    type: DataTypes.STRING(128),
    allowNull: true,
    field: 'last_buyer'
  },
  lastBuyAtUnix: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'last_buy_at_unix'
  },
  adminCancelled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'admin_cancelled'
  },
  adminCancelledBy: {
    type: DataTypes.STRING(128),
    allowNull: true,
    field: 'admin_cancelled_by'
  },
  itemData: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'item_data'
  },
  itemMeta: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'item_meta'
  },
  scriptStats: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'script_stats'
  }
}, {
  tableName: 'flea_market_listings',
  timestamps: true
});

