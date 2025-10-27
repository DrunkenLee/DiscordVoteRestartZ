import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const ZMUser = sequelize.define('ZMUser', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  discordid: {
    type: DataTypes.STRING,
    allowNull: true
  },
  steamid: {
    type: DataTypes.STRING,
    allowNull: true
  },
  ownerid: {
    type: DataTypes.STRING,
    allowNull: true
  },
  username1: DataTypes.STRING,
  password1: DataTypes.STRING,
  username2: DataTypes.STRING,
  password2: DataTypes.STRING,
  extradata: DataTypes.TEXT,
  accesslevel: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'zmusers',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false // The table doesn't have an updated_at column
});
