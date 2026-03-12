import { Sequelize } from 'sequelize';
import sequelizeHelper from '../../config/sequelize-helper.cjs';

export const sequelize = sequelizeHelper.createSequelizeInstance(Sequelize);
