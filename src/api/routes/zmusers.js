import express from 'express';
import { ZMUser } from '../../models/zmuser.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const users = await ZMUser.findAll();
  res.json(users);
});

router.get('/:id', async (req, res) => {
  const user = await ZMUser.findByPk(req.params.id);
  if (user) {
    res.json(user);
  } else {
    res.sendStatus(404);
  }
});

router.post('/', async (req, res) => {
  try {
    const user = await ZMUser.create(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const [updated] = await ZMUser.update(req.body, { where: { userid: req.params.id } });
    if (updated) {
      const user = await ZMUser.findByPk(req.params.id);
      res.json(user);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const deleted = await ZMUser.destroy({ where: { userid: req.params.id } });
  if (deleted) {
    res.sendStatus(204);
  } else {
    res.sendStatus(404);
  }
});

export default router;
