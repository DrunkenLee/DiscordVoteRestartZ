import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const FleaMarketAccount = sequelize.define('FleaMarketAccount', {
  username: {
    type: DataTypes.STRING(128),
    allowNull: false,
    primaryKey: true
  },
  pending: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  sales: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  }
}, {
  tableName: 'flea_market_accounts',
  timestamps: true
});

