import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';
import { ZMUser } from './zmuser.js';

export const PlayerAuction = sequelize.define('PlayerAuction', {
  itemid: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sellerid: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  itemname: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  itemdesc: DataTypes.TEXT,
  itemprice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  lastbid: DataTypes.DECIMAL(10, 2),
  status: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: 'player_auctions',
  timestamps: false
});

PlayerAuction.belongsTo(ZMUser, { foreignKey: 'sellerid', as: 'seller' });
