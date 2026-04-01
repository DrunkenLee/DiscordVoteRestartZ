import express from 'express';
import { VirtualGarageSnapshot } from '../../models/virtualGarageSnapshot.js';
import logger from '../../utils/logger.js';

const router = express.Router();

const ALLOWED_STATUSES = new Set(['active', 'restored', 'deleted']);
const SORT_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'savedTime', 'vehicleId', 'status']);

function generateRequestId() {
  return `vg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return {};

  const snapshot = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null;

  return {
    filePath: payload.filePath,
    ownerUsername: payload.ownerUsername,
    ownerSteamId: payload.ownerSteamId,
    vehicleId: payload.vehicleId,
    vehicleName: payload.vehicleName,
    scriptName: payload.scriptName,
    status: payload.status,
    sourceServer: payload.sourceServer,
    hasSnapshot: payload.snapshot !== undefined,
    hasSummary: payload.summary !== undefined,
    snapshotPartsCount: Array.isArray(snapshot?.parts) ? snapshot.parts.length : 0,
    snapshotKeys: snapshot ? Object.keys(snapshot).slice(0, 12) : []
  };
}

function requestContext(req) {
  return {
    requestId: req.vgRequestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  };
}

router.use((req, res, next) => {
  req.vgRequestId = generateRequestId();
  const startedAt = Date.now();

  logger.info('virtual-garage request start', {
    ...requestContext(req),
    query: req.query || {},
    body: summarizePayload(req.body)
  });

  res.on('finish', () => {
    logger.info('virtual-garage request end', {
      ...requestContext(req),
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
});

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
    logger.info('virtual-garage list success', {
      ...requestContext(req),
      count: rows.length,
      filters: where,
      sort,
      order
    });
    res.json(rows.map((row) => sanitizeListRecord(row, includeSnapshot)));
  } catch (err) {
    logger.error('virtual-garage list failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
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

    logger.info('virtual-garage owner list success', {
      ...requestContext(req),
      ownerUsername,
      count: rows.length
    });
    res.json(rows.map((row) => sanitizeListRecord(row, includeSnapshot)));
  } catch (err) {
    logger.error('virtual-garage owner list failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
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
      logger.info('virtual-garage by-file not found', {
        ...requestContext(req),
        filePath
      });
      return res.sendStatus(404);
    }

    const includeSnapshot = req.query.includeSnapshot === 'true';
    logger.info('virtual-garage by-file success', {
      ...requestContext(req),
      filePath,
      id: row.id
    });
    res.json(sanitizeListRecord(row, includeSnapshot));
  } catch (err) {
    logger.error('virtual-garage by-file failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = buildPayload(req.body || {}, { requireCreateFields: true });
    applyStatusTimestamps(payload, payload.status);

    const created = await VirtualGarageSnapshot.create(payload);
    logger.info('virtual-garage create success', {
      ...requestContext(req),
      id: created.id,
      filePath: created.filePath,
      ownerUsername: created.ownerUsername,
      status: created.status
    });
    res.status(201).json(created);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('virtual-garage create failed', {
      ...requestContext(req),
      error: err.message,
      statusCode,
      body: summarizePayload(req.body),
      stack: err.stack
    });
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
      logger.info('virtual-garage upsert created', {
        ...requestContext(req),
        id: created.id,
        filePath: created.filePath,
        ownerUsername: created.ownerUsername,
        status: created.status
      });
      return res.status(201).json(created);
    }

    await existing.update(payload);
    logger.info('virtual-garage upsert updated', {
      ...requestContext(req),
      id: existing.id,
      filePath: existing.filePath,
      ownerUsername: existing.ownerUsername,
      status: existing.status
    });
    res.json(existing);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('virtual-garage upsert failed', {
      ...requestContext(req),
      error: err.message,
      statusCode,
      body: summarizePayload(req.body),
      stack: err.stack
    });
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
      logger.info('virtual-garage status-by-file created', {
        ...requestContext(req),
        id: row.id,
        filePath: row.filePath,
        ownerUsername: row.ownerUsername,
        status: row.status
      });
      return res.status(201).json(row);
    }

    await row.update(payload);
    logger.info('virtual-garage status-by-file updated', {
      ...requestContext(req),
      id: row.id,
      filePath: row.filePath,
      ownerUsername: row.ownerUsername,
      status: row.status
    });
    res.json(row);
  } catch (err) {
    logger.error('virtual-garage status-by-file failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizePayload(req.body),
      stack: err.stack
    });
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
      logger.info('virtual-garage get-by-id not found', {
        ...requestContext(req),
        id
      });
      return res.sendStatus(404);
    }

    const includeSnapshot = req.query.includeSnapshot === 'true';
    logger.info('virtual-garage get-by-id success', {
      ...requestContext(req),
      id
    });
    res.json(sanitizeListRecord(row, includeSnapshot));
  } catch (err) {
    logger.error('virtual-garage get-by-id failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
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
      logger.info('virtual-garage update-by-id not found', {
        ...requestContext(req),
        id
      });
      return res.sendStatus(404);
    }

    await row.update(payload);
    logger.info('virtual-garage update-by-id success', {
      ...requestContext(req),
      id: row.id,
      filePath: row.filePath,
      ownerUsername: row.ownerUsername,
      status: row.status
    });
    res.json(row);
  } catch (err) {
    logger.error('virtual-garage update-by-id failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizePayload(req.body),
      stack: err.stack
    });
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
      logger.info('virtual-garage delete-by-file not found', {
        ...requestContext(req),
        filePath
      });
      return res.sendStatus(404);
    }

    logger.info('virtual-garage delete-by-file success', {
      ...requestContext(req),
      filePath
    });
    res.sendStatus(204);
  } catch (err) {
    logger.error('virtual-garage delete-by-file failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
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
      logger.info('virtual-garage delete-by-id not found', {
        ...requestContext(req),
        id
      });
      return res.sendStatus(404);
    }

    logger.info('virtual-garage delete-by-id success', {
      ...requestContext(req),
      id
    });
    res.sendStatus(204);
  } catch (err) {
    logger.error('virtual-garage delete-by-id failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: err.message });
  }
});

export default router;
