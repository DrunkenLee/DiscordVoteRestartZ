import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const DashboardFeedPost = sequelize.define('DashboardFeedPost', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  authorName: {
    type: DataTypes.STRING(128),
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  imageUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'dashboard_feed_posts',
  timestamps: true,
});

