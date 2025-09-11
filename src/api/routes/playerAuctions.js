import express from 'express';
import { PlayerAuction } from '../../models/playerAuction.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const auctions = await PlayerAuction.findAll();
  res.json(auctions);
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
