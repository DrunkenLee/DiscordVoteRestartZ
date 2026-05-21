import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const DashboardFeedLike = sequelize.define('DashboardFeedLike', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
  },
  postId: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  userId: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
}, {
  tableName: 'dashboard_feed_likes',
  timestamps: true,
});

