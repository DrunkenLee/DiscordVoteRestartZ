import express from 'express';
import { VirtualGarageSnapshot } from '../../models/virtualGarageSnapshot.js';

const router = express.Router();

const ALLOWED_STATUSES = new Set(['active', 'restored', 'deleted']);
const SORT_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'savedTime', 'vehicleId', 'status']);

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeStatus(value, fallback = 'active') {
  const normalized = normalizeText(value);
  if (!normalized) return fallback;

  const lowered = normalized.toLowerCase();
  if (!ALLOWED_STATUSES.has(lowered)) {
    return null;
  }
  return lowered;
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parsePositiveInteger(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeJsonInput(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return value;
    }
  }
  return value;
}

function buildPayload(body, { requireCreateFields = false } = {}) {
  const payload = {};

  const filePath = normalizeText(body.filePath);
  const ownerUsername = normalizeText(body.ownerUsername);
  const ownerSteamId = normalizeText(body.ownerSteamId);
  const vehicleName = normalizeText(body.vehicleName);
  const scriptName = normalizeText(body.scriptName);
  const sourceServer = normalizeText(body.sourceServer);

  if (filePath !== null) payload.filePath = filePath;
  if (ownerUsername !== null) payload.ownerUsername = ownerUsername;
  if (ownerSteamId !== null || body.ownerSteamId === null) payload.ownerSteamId = ownerSteamId;
  if (vehicleName !== null || body.vehicleName === null) payload.vehicleName = vehicleName;
  if (scriptName !== null || body.scriptName === null) payload.scriptName = scriptName;
  if (sourceServer !== null || body.sourceServer === null) payload.sourceServer = sourceServer;

  if (body.vehicleId !== undefined) {
    const vehicleId = parseOptionalInteger(body.vehicleId);
    if (vehicleId === null && body.vehicleId !== null && body.vehicleId !== '') {
      throw new Error('vehicleId must be a number');
    }
    payload.vehicleId = vehicleId;
  }

  if (body.savedTime !== undefined) {
    const savedTime = parseOptionalInteger(body.savedTime);
    if (savedTime === null && body.savedTime !== null && body.savedTime !== '') {
      throw new Error('savedTime must be a number');
    }
    payload.savedTime = savedTime;
  }

  if (body.status !== undefined) {
    const status = normalizeStatus(body.status, null);
    if (!status) {
      throw new Error('status must be one of: active, restored, deleted');
    }
    payload.status = status;
  }

  if (body.snapshot !== undefined) {
    payload.snapshot = normalizeJsonInput(body.snapshot);
  }

  if (body.summary !== undefined) {
    payload.summary = normalizeJsonInput(body.summary);
  }

  if (body.restoredAt !== undefined) {
    payload.restoredAt = body.restoredAt ? new Date(body.restoredAt) : null;
  }

  if (body.deletedAt !== undefined) {
    payload.deletedAt = body.deletedAt ? new Date(body.deletedAt) : null;
  }

  if (requireCreateFields) {
    if (!payload.filePath) {
      throw new Error('filePath is required');
    }
    if (!payload.ownerUsername) {
      throw new Error('ownerUsername is required');
    }
    if (!payload.status) {
      payload.status = 'active';
    }
  }

  return payload;
}

function applyStatusTimestamps(payload, status) {
  if (!status) return payload;

  if (status === 'restored') {
    payload.restoredAt = payload.restoredAt ?? new Date();
    payload.deletedAt = null;
  } else if (status === 'deleted') {
    payload.deletedAt = payload.deletedAt ?? new Date();
  } else if (status === 'active') {
    payload.deletedAt = null;
  }

  return payload;
}

function sanitizeListRecord(record, includeSnapshot) {
  const data = record.toJSON();
  if (!includeSnapshot) {
    delete data.snapshot;
  }
  return data;
}

router.get('/', async (req, res) => {
  try {
    const where = {};
    const ownerUsername = normalizeText(req.query.ownerUsername);
    const status = req.query.status ? normalizeStatus(req.query.status, null) : null;
    const filePath = normalizeText(req.query.filePath);
    const vehicleId = req.query.vehicleId !== undefined ? parseOptionalInteger(req.query.vehicleId) : null;

    if (req.query.status && !status) {
      return res.status(400).json({ error: 'Invalid status. Use: active, restored, deleted' });
    }

    if (ownerUsername) where.ownerUsername = ownerUsername;
    if (status) where.status = status;
    if (filePath) where.filePath = filePath;
    if (req.query.vehicleId !== undefined) {
      if (vehicleId === null && req.query.vehicleId !== '' && req.query.vehicleId !== null) {
        return res.status(400).json({ error: 'vehicleId must be a number' });
      }
      where.vehicleId = vehicleId;
    }

    const sort = SORT_FIELDS.has(req.query.sort) ? req.query.sort : 'createdAt';
    const order = String(req.query.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const limit = req.query.limit ? parsePositiveInteger(req.query.limit) : null;
    const offset = req.query.offset ? parseOptionalInteger(req.query.offset) : null;
    const includeSnapshot = req.query.includeSnapshot === 'true';

    const options = {
      where,
      order: [[sort, order]]
    };

    if (limit) options.limit = limit;
    if (offset !== null && offset !== undefined) options.offset = Math.max(0, offset);

    const rows = await VirtualGarageSnapshot.findAll(options);
    res.json(rows.map((row) => sanitizeListRecord(row, includeSnapshot)));
  } catch (err) {
    console.error('Error listing virtual garage snapshots:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/owner/:ownerUsername', async (req, res) => {
  try {
    const ownerUsername = normalizeText(req.params.ownerUsername);
    if (!ownerUsername) {
      return res.status(400).json({ error: 'ownerUsername is required' });
    }

    const includeSnapshot = req.query.includeSnapshot === 'true';
    const rows = await VirtualGarageSnapshot.findAll({
      where: { ownerUsername },
      order: [['createdAt', 'DESC']]
    });

    res.json(rows.map((row) => sanitizeListRecord(row, includeSnapshot)));
  } catch (err) {
    console.error('Error fetching owner snapshots:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-file', async (req, res) => {
  try {
    const filePath = normalizeText(req.query.filePath);
    if (!filePath) {
      return res.status(400).json({ error: 'filePath query param is required' });
    }

    const row = await VirtualGarageSnapshot.findOne({ where: { filePath } });
    if (!row) {
      return res.sendStatus(404);
    }

    const includeSnapshot = req.query.includeSnapshot === 'true';
    res.json(sanitizeListRecord(row, includeSnapshot));
  } catch (err) {
    console.error('Error fetching snapshot by file:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = buildPayload(req.body || {}, { requireCreateFields: true });
    applyStatusTimestamps(payload, payload.status);

    const created = await VirtualGarageSnapshot.create(payload);
    res.status(201).json(created);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

router.post('/upsert', async (req, res) => {
  try {
    const payload = buildPayload(req.body || {}, { requireCreateFields: true });
    applyStatusTimestamps(payload, payload.status);

    const existing = await VirtualGarageSnapshot.findOne({
      where: { filePath: payload.filePath }
    });

    if (!existing) {
      const created = await VirtualGarageSnapshot.create(payload);
      return res.status(201).json(created);
    }

    await existing.update(payload);
    res.json(existing);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

router.patch('/by-file/status', async (req, res) => {
  try {
    const filePath = normalizeText(req.body?.filePath);
    const status = normalizeStatus(req.body?.status, null);

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }
    if (!status) {
      return res.status(400).json({ error: 'status must be one of: active, restored, deleted' });
    }

    const payload = buildPayload(req.body || {}, { requireCreateFields: false });
    payload.status = status;
    applyStatusTimestamps(payload, status);

    let row = await VirtualGarageSnapshot.findOne({ where: { filePath } });
    if (!row) {
      const ownerUsername = normalizeText(req.body?.ownerUsername);
      if (!ownerUsername) {
        return res.status(400).json({ error: 'ownerUsername is required when creating a new row by filePath' });
      }

      row = await VirtualGarageSnapshot.create({
        filePath,
        ownerUsername,
        status,
        ownerSteamId: payload.ownerSteamId ?? null,
        vehicleId: payload.vehicleId ?? null,
        vehicleName: payload.vehicleName ?? null,
        scriptName: payload.scriptName ?? null,
        snapshot: payload.snapshot ?? null,
        summary: payload.summary ?? null,
        savedTime: payload.savedTime ?? null,
        sourceServer: payload.sourceServer ?? null,
        restoredAt: payload.restoredAt ?? null,
        deletedAt: payload.deletedAt ?? null
      });
      return res.status(201).json(row);
    }

    await row.update(payload);
    res.json(row);
  } catch (err) {
    console.error('Error updating snapshot status by file:', err);
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const row = await VirtualGarageSnapshot.findByPk(id);
    if (!row) {
      return res.sendStatus(404);
    }

    const includeSnapshot = req.query.includeSnapshot === 'true';
    res.json(sanitizeListRecord(row, includeSnapshot));
  } catch (err) {
    console.error('Error fetching snapshot by id:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const payload = buildPayload(req.body || {}, { requireCreateFields: false });
    if (payload.status) {
      applyStatusTimestamps(payload, payload.status);
    }

    const row = await VirtualGarageSnapshot.findByPk(id);
    if (!row) {
      return res.sendStatus(404);
    }

    await row.update(payload);
    res.json(row);
  } catch (err) {
    console.error('Error updating snapshot by id:', err);
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

router.delete('/by-file', async (req, res) => {
  try {
    const filePath = normalizeText(req.query.filePath);
    if (!filePath) {
      return res.status(400).json({ error: 'filePath query param is required' });
    }

    const deleted = await VirtualGarageSnapshot.destroy({ where: { filePath } });
    if (!deleted) {
      return res.sendStatus(404);
    }

    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting snapshot by file:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const deleted = await VirtualGarageSnapshot.destroy({ where: { id } });
    if (!deleted) {
      return res.sendStatus(404);
    }

    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting snapshot by id:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

