import express from 'express';
import { Op } from 'sequelize';
import { PlayerAuction } from '../../models/playerAuction.js';

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

router.get('/:id', async (req, res) => {
  const auction = await PlayerAuction.findByPk(req.params.id);
  if (auction) {
    res.json(auction);
  } else {
    res.sendStatus(404);
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
