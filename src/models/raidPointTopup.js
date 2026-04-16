import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';

export const RaidPointTopup = sequelize.define('RaidPointTopup', {
  id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.BIGINT,
    allowNull: false,
    field: 'user_id'
  },
  username: {
    type: DataTypes.STRING(128),
    allowNull: false
  },
  raidPoints: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'raid_points'
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  idrPerRaidPoint: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2000,
    field: 'idr_per_raid_point'
  },
  autogopayTransactionId: {
    type: DataTypes.STRING(128),
    allowNull: false,
    unique: true,
    field: 'autogopay_transaction_id'
  },
  autogopayOrderId: {
    type: DataTypes.STRING(128),
    allowNull: true,
    field: 'autogopay_order_id'
  },
  autogopayStatus: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'pending',
    field: 'autogopay_status'
  },
  paymentStatus: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'pending',
    field: 'payment_status'
  },
  creditStatus: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'pending',
    field: 'credit_status'
  },
  gatewayMessage: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'gateway_message'
  },
  qrUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'qr_url'
  },
  qrString: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'qr_string'
  },
  transactionTime: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'transaction_time'
  },
  expiryTime: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'expiry_time'
  },
  paidAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'paid_at'
  },
  creditedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'credited_at'
  },
  lastStatusCheckedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_status_checked_at'
  },
  callbackVerified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'callback_verified'
  },
  callbackEvent: {
    type: DataTypes.STRING(64),
    allowNull: true,
    field: 'callback_event'
  },
  callbackPayload: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'callback_payload'
  },
  gatewayPayload: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'gateway_payload'
  },
  creditError: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'credit_error'
  }
}, {
  tableName: 'raid_point_topups',
  timestamps: true
});

