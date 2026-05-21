import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const DashboardFeedComment = sequelize.define('DashboardFeedComment', {
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
}, {
  tableName: 'dashboard_feed_comments',
  timestamps: true,
});

