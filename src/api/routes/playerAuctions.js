import express from 'express';
import { Op } from 'sequelize';
import { PlayerAuction } from '../../models/playerAuction.js';
import { ZMUser } from '../../models/zmuser.js';

const router = express.Router();

// GET /api/player-auctions
// Query params:
// - status: filter by exact status (e.g., 'active')
// - available: if 'true', filter to auctions that are currently open/available (status in ['active','open'] and buyerid is null)
// - search: text search on itemname (ILIKE)
// - sort: field to sort by (createdAt|itemprice|lastbid), default createdAt
// - order: ASC|DESC, default DESC
// - limit, offset: basic pagination
router.get('/', async (req, res) => {
  try {
    const { status, available, search, sort = 'createdAt', order = 'DESC', limit, offset } = req.query;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (available === 'true') {
      where.status = where.status || { [Op.in]: ['active', 'open'] };
      where.buyerid = { [Op.is]: null };
    }

    if (search) {
      where.itemname = { [Op.iLike]: `%${search}%` };
    }

    const validSorts = ['createdAt', 'itemprice', 'lastbid'];
    const sortField = validSorts.includes(sort) ? sort : 'createdAt';
    const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const options = {
      where,
      order: [[sortField, sortOrder]],
      attributes: {
        exclude: ['moddata', 'itemdata']
      }
    };

    if (limit) options.limit = Number(limit);
    if (offset) options.offset = Number(offset);

    const auctions = await PlayerAuction.findAll(options);
    res.json(auctions);
  } catch (err) {
    console.error('Error fetching auctions:', err);
    res.status(500).json({ message: 'Failed to fetch auctions' });
  }
});

// GET /api/player-auctions/user/:userId
// Get all auctions for a specific user (by ZMUser ID)
// Matches sellername against user's username1 and username2
router.get('/user/:userId', async (req, res) => {
  try {
    const user = await ZMUser.findByPk(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const usernames = [user.username1, user.username2].filter(Boolean);
    if (usernames.length === 0) {
      return res.json([]);
    }

    const auctions = await PlayerAuction.findAll({
      where: {
        sellername: { [Op.in]: usernames }
      },
      order: [['createdAt', 'DESC']],
      attributes: {
        exclude: ['moddata', 'itemdata']
      }
    });

    res.json(auctions);
  } catch (err) {
    console.error('Error fetching user auctions:', err);
    res.status(500).json({ message: 'Failed to fetch user auctions' });
  }
});

// GET /api/player-auctions/:id
// Returns full auction details including all fields (moddata, itemdata, etc.)
router.get('/:id', async (req, res) => {
  try {
    const auction = await PlayerAuction.findByPk(req.params.id);
    if (auction) {
      res.json(auction);
    } else {
      res.status(404).json({ message: 'Auction not found' });
    }
  } catch (err) {
    console.error('Error fetching auction details:', err);
    res.status(500).json({ message: 'Failed to fetch auction details' });
  }
});

router.post('/', async (req, res) => {
  try {
    const auction = await PlayerAuction.create(req.body);
    res.status(201).json(auction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/player-auctions/:id/manage
// Update auction status or price (owner only)
// Body: { userId, status?, itemprice? }
router.patch('/:id/manage', async (req, res) => {
  try {
    const { userId, status, itemprice } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // Verify user exists
    const user = await ZMUser.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get the auction
    const auction = await PlayerAuction.findByPk(req.params.id);
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }

    // Verify ownership - check if sellername matches user's username1 or username2
    const usernames = [user.username1, user.username2].filter(Boolean);
    if (!usernames.includes(auction.sellername)) {
      return res.status(403).json({ message: 'You do not own this auction' });
    }

    // Build update object with only allowed fields
    const updateData = {};
    if (status !== undefined) {
      updateData.status = status;
    }
    if (itemprice !== undefined) {
      updateData.itemprice = itemprice;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Update the auction
    await auction.update(updateData);

    res.json(auction);
  } catch (err) {
    console.error('Error managing auction:', err);
    res.status(500).json({ message: 'Failed to update auction' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const [updated] = await PlayerAuction.update(req.body, { where: { itemid: req.params.id } });
    if (updated) {
      const auction = await PlayerAuction.findByPk(req.params.id);
      res.json(auction);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const deleted = await PlayerAuction.destroy({ where: { itemid: req.params.id } });
  if (deleted) {
    res.sendStatus(204);
  } else {
    res.sendStatus(404);
  }
});

export default router;
