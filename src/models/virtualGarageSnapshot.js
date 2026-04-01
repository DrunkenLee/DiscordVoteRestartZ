import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const VirtualGarageSnapshot = sequelize.define('VirtualGarageSnapshot', {
  id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true
  },
  filePath: {
    type: DataTypes.STRING(512),
    allowNull: false,
    unique: true,
    field: 'file_path'
  },
  ownerUsername: {
    type: DataTypes.STRING(128),
    allowNull: false,
    field: 'owner_username'
  },
  ownerSteamId: {
    type: DataTypes.STRING(64),
    allowNull: true,
    field: 'owner_steam_id'
  },
  vehicleId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'vehicle_id'
  },
  vehicleName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'vehicle_name'
  },
  scriptName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'script_name'
  },
  status: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'active'
  },
  snapshot: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  summary: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  savedTime: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'saved_time'
  },
  sourceServer: {
    type: DataTypes.STRING(128),
    allowNull: true,
    field: 'source_server'
  },
  restoredAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'restored_at'
  },
  deletedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'deleted_at'
  }
}, {
  tableName: 'virtual_garage_snapshots',
  timestamps: true
});

