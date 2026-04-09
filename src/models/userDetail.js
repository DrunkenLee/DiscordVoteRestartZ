import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const USER_DETAIL_STATUSES = ['idle', 'raiding', 'chilling'];

export const UserDetail = sequelize.define('UserDetail', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.BIGINT,
    allowNull: false,
    unique: true,
  },
  nickname: {
    type: DataTypes.STRING(48),
    allowNull: true,
  },
  avatarPath: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'idle',
    validate: {
      isIn: [USER_DETAIL_STATUSES],
    },
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'user_details',
  timestamps: true,
});

