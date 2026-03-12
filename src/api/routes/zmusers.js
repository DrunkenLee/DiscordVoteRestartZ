import express from 'express';
import { ZMUser } from '../../models/zmuser.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const users = await ZMUser.findAll();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await ZMUser.findByPk(id);
    if (user) {
      res.json(user);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const [updated] = await ZMUser.update(req.body, { where: { id } });
    if (updated) {
      const user = await ZMUser.findByPk(id);
      res.json(user);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const deleted = await ZMUser.destroy({ where: { id } });
    if (deleted) {
      res.sendStatus(204);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
