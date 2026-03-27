import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const AdminClockSession = sequelize.define(
  'AdminClockSession',
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    discordUserId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    discordUsername: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    discordDisplayName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    guildId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    clockInChannelId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    clockOutChannelId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    workDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    clockInAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    clockOutAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    durationMinutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: 'admin_clock_sessions',
    timestamps: true,
  }
);
