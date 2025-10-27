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
      const token = jwt.sign({ id: user.id, username: user.username1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, user: { id: user.id, username: user.username1 } });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
