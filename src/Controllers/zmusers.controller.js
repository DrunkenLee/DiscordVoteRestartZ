import jwt from 'jsonwebtoken';
import { ZMUser } from '../models/zmuser.js';
import { Op } from 'sequelize';

export const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await ZMUser.findOne({
      where: {
        [Op.or]: [
          { username1: username },
          { username2: username }
        ],
        password1: password,
        accesslevel: null
      }
    });

    if (user) {
      const userId = user.id ?? user.userid;
      const token = jwt.sign({ id: userId, username: user.username1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const userData = { ...user.toJSON() };
      delete userData.password1;
      delete userData.password2;
      res.json({ token, user: userData });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
