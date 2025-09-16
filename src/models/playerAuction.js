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
  sellername: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  buyername: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  buyerid: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  buyerUsername: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: 'player_auctions',
  timestamps: true
});

PlayerAuction.belongsTo(ZMUser, { foreignKey: 'sellerid', targetKey: 'id', as: 'seller' });
