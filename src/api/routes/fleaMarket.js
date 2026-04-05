import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { sequelize } from '../../models/index.js';
import { FleaMarketListing } from '../../models/fleaMarketListing.js';
import { FleaMarketAccount } from '../../models/fleaMarketAccount.js';
import { SftpLogReader } from '../../utils/sftpLogReader.js';
import logger from '../../utils/logger.js';

const router = express.Router();

const LISTING_STATUSES = new Set(['active', 'sold', 'expired', 'redeemed', 'deleted']);
const LISTING_SORT_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'createdAtUnix',
  'expiresAtUnix',
  'soldAtUnix',
  'price',
  'qty',
  'total',
  'status'
]);

const DEV_PUBLIC_LISTINGS_PATH = process.env.FLEA_MARKET_PUBLIC_LISTINGS_DEV_PATH
  || 'C:\\Users\\Michael\\Zomboid\\Lua\\ZMFleaMarket\\ZMFleaMarket_public_listings.json';
const LIVE_PUBLIC_LISTINGS_PATH = process.env.FLEA_MARKET_PUBLIC_LISTINGS_REMOTE_PATH
  || '/home/pzserver/Zomboid/Lua/ZMFleaMarket/ZMFleaMarket_public_listings.json';
const PUBLIC_CACHE_MAX_ITEMS = resolvePublicCacheMaxItems();

const fleaMarketCacheSftp = new SftpLogReader();

function resolvePublicCacheMaxItems() {
  const parsed = Number.parseInt(process.env.FLEA_MARKET_PUBLIC_CACHE_MAX_ITEMS || '100', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return parsed;
}

function isDevCacheMode() {
  const explicitMode = normalizeText(process.env.FLEA_MARKET_CACHE_MODE);
  if (explicitMode) {
    const mode = explicitMode.toLowerCase();
    if (mode === 'dev' || mode === 'development' || mode === 'local') return true;
    if (mode === 'live' || mode === 'prod' || mode === 'production') return false;
  }

  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'development') return true;
  if (nodeEnv === 'production') return false;

  return process.platform === 'win32';
}

function buildPublicListingsCacheSnapshot(listings) {
  const rows = Array.isArray(listings) ? listings : [];
  const limitedRows = rows.slice(0, PUBLIC_CACHE_MAX_ITEMS);
  return {
    listings: limitedRows,
    updatedAt: Date.now(),
    updatedAtIso: new Date().toISOString(),
    total: rows.length,
    count: limitedRows.length,
    maxItems: PUBLIC_CACHE_MAX_ITEMS
  };
}

async function writePublicListingsCache(listings, req) {
  const snapshot = buildPublicListingsCacheSnapshot(listings);
  const payload = JSON.stringify(snapshot, null, 2);
  const useDevPath = isDevCacheMode();
  const targetPath = useDevPath ? DEV_PUBLIC_LISTINGS_PATH : LIVE_PUBLIC_LISTINGS_PATH;
  const cacheMode = useDevPath ? 'dev' : 'live';

  if (useDevPath) {
    const tmpPath = `${targetPath}.tmp`;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(tmpPath, payload, 'utf8');
    await fs.rename(tmpPath, targetPath);
  } else {
    await fleaMarketCacheSftp.writeTextFile(targetPath, payload, { ensureDir: true });
  }

  logger.info('flea-market public cache updated', {
    ...requestContext(req),
    cacheMode,
    cachePath: targetPath,
    count: snapshot.count,
    total: snapshot.total,
    maxItems: snapshot.maxItems
  });
}

function generateRequestId() {
  return `fm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requestContext(req) {
  return {
    requestId: req.fmRequestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  };
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeBoolean(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  const lowered = String(value).toLowerCase();
  if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
  if (lowered === 'false' || lowered === '0' || lowered === 'no') return false;
  return undefined;
}

function parseInteger(value, fieldName, { allowNull = true, min = null } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    if (allowNull) return null;
    throw new Error(`${fieldName} is required`);
  }

  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  if (min !== null && n < min) {
    throw new Error(`${fieldName} must be >= ${min}`);
  }
  return n;
}

function normalizeJsonInput(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value;

  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function normalizeStatus(value, { required = false } = {}) {
  const status = normalizeText(value);
  if (!status) {
    if (required) throw new Error('status is required');
    return undefined;
  }
  const lowered = status.toLowerCase();
  if (!LISTING_STATUSES.has(lowered)) {
    throw new Error('status must be one of: active, sold, expired, redeemed, deleted');
  }
  return lowered;
}

function summarizeBody(body) {
  if (!body || typeof body !== 'object') return {};
  return {
    keys: Object.keys(body),
    listingsCount: Array.isArray(body.listings) ? body.listings.length : undefined,
    accountsCount: Array.isArray(body.accounts) ? body.accounts.length : undefined,
    listingId: body.id,
    seller: body.seller,
    username: body.username
  };
}

function sanitizeListing(row, { includeItemData = false, includeScriptStats = false } = {}) {
  const data = row.toJSON();
  if (!includeItemData) {
    delete data.itemData;
  }
  if (!includeScriptStats) {
    delete data.scriptStats;
  }
  return data;
}

function sanitizeAccount(row) {
  return row.toJSON();
}

function buildListingPayload(body, { requireCreateFields = false } = {}) {
  const payload = {};

  const id = parseInteger(body.id, 'id', { allowNull: false, min: 1 });
  if (id !== undefined) payload.id = id;

  const seller = normalizeText(body.seller);
  const buyer = normalizeText(body.buyer);
  const itemType = normalizeText(body.itemType);
  const displayName = normalizeText(body.displayName);
  const lastBuyer = normalizeText(body.lastBuyer);
  const adminCancelledBy = normalizeText(body.adminCancelledBy);

  if (seller !== null && seller !== undefined) payload.seller = seller;
  if (buyer !== undefined) payload.buyer = buyer;
  if (itemType !== null && itemType !== undefined) payload.itemType = itemType;
  if (displayName !== undefined) payload.displayName = displayName;
  if (lastBuyer !== undefined) payload.lastBuyer = lastBuyer;
  if (adminCancelledBy !== undefined) payload.adminCancelledBy = adminCancelledBy;

  const qty = parseInteger(body.qty, 'qty', { allowNull: false, min: 0 });
  const price = parseInteger(body.price, 'price', { allowNull: false, min: 0 });
  const total = parseInteger(body.total, 'total', { allowNull: false, min: 0 });
  const createdAtUnix = parseInteger(body.createdAt, 'createdAt', { allowNull: true, min: 0 });
  const expiresAtUnix = parseInteger(body.expiresAt, 'expiresAt', { allowNull: true, min: 0 });
  const soldAtUnix = parseInteger(body.soldAt, 'soldAt', { allowNull: true, min: 0 });
  const expiredAtUnix = parseInteger(body.expiredAt, 'expiredAt', { allowNull: true, min: 0 });
  const redeemedAtUnix = parseInteger(body.redeemedAt, 'redeemedAt', { allowNull: true, min: 0 });
  const transactionFee = parseInteger(body.transactionFee, 'transactionFee', { allowNull: false, min: 0 });
  const listingFee = parseInteger(body.listingFee, 'listingFee', { allowNull: false, min: 0 });
  const lastBuyAtUnix = parseInteger(body.lastBuyAt, 'lastBuyAt', { allowNull: true, min: 0 });

  if (qty !== undefined) payload.qty = qty;
  if (price !== undefined) payload.price = price;
  if (total !== undefined) payload.total = total;
  if (createdAtUnix !== undefined) payload.createdAtUnix = createdAtUnix;
  if (expiresAtUnix !== undefined) payload.expiresAtUnix = expiresAtUnix;
  if (soldAtUnix !== undefined) payload.soldAtUnix = soldAtUnix;
  if (expiredAtUnix !== undefined) payload.expiredAtUnix = expiredAtUnix;
  if (redeemedAtUnix !== undefined) payload.redeemedAtUnix = redeemedAtUnix;
  if (transactionFee !== undefined) payload.transactionFee = transactionFee;
  if (listingFee !== undefined) payload.listingFee = listingFee;
  if (lastBuyAtUnix !== undefined) payload.lastBuyAtUnix = lastBuyAtUnix;

  const status = normalizeStatus(body.status);
  if (status !== undefined) payload.status = status;

  const adminCancelled = normalizeBoolean(body.adminCancelled);
  if (adminCancelled !== undefined && adminCancelled !== null) {
    payload.adminCancelled = adminCancelled;
  }

  if (body.itemData !== undefined) payload.itemData = normalizeJsonInput(body.itemData);
  if (body.itemMeta !== undefined) payload.itemMeta = normalizeJsonInput(body.itemMeta);
  if (body.scriptStats !== undefined) payload.scriptStats = normalizeJsonInput(body.scriptStats);

  if (requireCreateFields) {
    if (!payload.seller) throw new Error('seller is required');
    if (!payload.itemType) throw new Error('itemType is required');
    if (payload.qty === undefined) throw new Error('qty is required');
    if (payload.price === undefined) throw new Error('price is required');
    if (payload.total === undefined) payload.total = payload.qty * payload.price;
    if (!payload.status) payload.status = 'active';
  }

  return payload;
}

function buildAccountPayload(body, { requireUsername = false } = {}) {
  const payload = {};
  const username = normalizeText(body.username);
  if (username !== null && username !== undefined) payload.username = username;

  const pending = parseInteger(body.pending, 'pending', { allowNull: false });
  if (pending !== undefined) payload.pending = pending;

  if (body.sales !== undefined) {
    const sales = normalizeJsonInput(body.sales);
    if (sales !== null && !Array.isArray(sales)) {
      throw new Error('sales must be an array');
    }
    payload.sales = sales || [];
  }

  if (requireUsername && !payload.username) {
    throw new Error('username is required');
  }

  if (payload.pending === undefined && requireUsername) {
    payload.pending = 0;
  }
  if (payload.sales === undefined && requireUsername) {
    payload.sales = [];
  }

  return payload;
}

async function upsertListing(payload, transaction) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('listing payload is required');
  }

  let row = null;
  if (payload.id) {
    row = await FleaMarketListing.findByPk(payload.id, { transaction });
  }

  if (!row) {
    row = await FleaMarketListing.create(payload, { transaction });
    return { row, created: true };
  }

  await row.update(payload, { transaction });
  return { row, created: false };
}

async function upsertAccount(payload, transaction) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('account payload is required');
  }

  if (!payload.username) {
    throw new Error('username is required');
  }

  let row = await FleaMarketAccount.findByPk(payload.username, { transaction });
  if (!row) {
    row = await FleaMarketAccount.create(payload, { transaction });
    return { row, created: true };
  }

  await row.update(payload, { transaction });
  return { row, created: false };
}

router.use((req, res, next) => {
  req.fmRequestId = generateRequestId();
  const startedAt = Date.now();

  logger.info('flea-market request start', {
    ...requestContext(req),
    query: req.query || {},
    body: summarizeBody(req.body)
  });

  res.on('finish', () => {
    logger.info('flea-market request end', {
      ...requestContext(req),
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
});

router.get('/', async (_req, res) => {
  res.json({
    service: 'flea-market',
    ok: true,
    routes: {
      listings: [
        'GET /listings',
        'GET /listings/:id',
        'POST /listings',
        'PUT /listings/:id',
        'POST /listings/upsert',
        'POST /listings/bulk-upsert',
        'DELETE /listings/:id'
      ],
      accounts: [
        'GET /accounts',
        'GET /accounts/:username',
        'PUT /accounts/:username',
        'POST /accounts/upsert',
        'POST /accounts/bulk-upsert',
        'DELETE /accounts/:username'
      ],
      sync: [
        'POST /sync'
      ]
    }
  });
});

router.get('/listings', async (req, res) => {
  try {
    const where = {};
    const seller = normalizeText(req.query.seller);
    const buyer = normalizeText(req.query.buyer);
    const status = req.query.status ? normalizeStatus(req.query.status) : undefined;
    const itemType = normalizeText(req.query.itemType);

    if (seller) where.seller = seller;
    if (buyer) where.buyer = buyer;
    if (status) where.status = status;
    if (itemType) where.itemType = itemType;

    const sort = LISTING_SORT_FIELDS.has(req.query.sort) ? req.query.sort : 'createdAt';
    const order = String(req.query.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const limit = parseInteger(req.query.limit, 'limit', { allowNull: true, min: 1 });
    const offset = parseInteger(req.query.offset, 'offset', { allowNull: true, min: 0 });
    const includeItemData = req.query.includeItemData === 'true';
    const includeScriptStats = req.query.includeScriptStats === 'true';

    const options = {
      where,
      order: [[sort, order]]
    };
    if (limit !== undefined && limit !== null) options.limit = limit;
    if (offset !== undefined && offset !== null) options.offset = offset;

    const rows = await FleaMarketListing.findAll(options);
    const responseRows = rows.map((row) => sanitizeListing(row, { includeItemData, includeScriptStats }));
    const cacheRows = rows.map((row) => sanitizeListing(row, { includeItemData: true, includeScriptStats: true }));

    try {
      await writePublicListingsCache(cacheRows, req);
    } catch (cacheError) {
      logger.error('flea-market public cache write failed', {
        ...requestContext(req),
        error: cacheError.message,
        stack: cacheError.stack
      });
    }

    res.json(responseRows);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market list listings failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.get('/listings/:id', async (req, res) => {
  try {
    const id = parseInteger(req.params.id, 'id', { allowNull: false, min: 1 });
    const includeItemData = req.query.includeItemData === 'true';
    const includeScriptStats = req.query.includeScriptStats === 'true';
    const row = await FleaMarketListing.findByPk(id);
    if (!row) return res.sendStatus(404);
    res.json(sanitizeListing(row, { includeItemData, includeScriptStats }));
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market get listing failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.post('/listings', async (req, res) => {
  try {
    const payload = buildListingPayload(req.body || {}, { requireCreateFields: true });
    const created = await FleaMarketListing.create(payload);
    res.status(201).json(created);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market create listing failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.put('/listings/:id', async (req, res) => {
  try {
    const id = parseInteger(req.params.id, 'id', { allowNull: false, min: 1 });
    const payload = buildListingPayload(req.body || {}, { requireCreateFields: false });
    delete payload.id;

    const row = await FleaMarketListing.findByPk(id);
    if (!row) return res.sendStatus(404);
    await row.update(payload);
    res.json(row);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market update listing failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.post('/listings/upsert', async (req, res) => {
  try {
    const payload = buildListingPayload(req.body || {}, { requireCreateFields: true });
    const { row, created } = await upsertListing(payload, null);
    res.status(created ? 201 : 200).json(row);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market upsert listing failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.post('/listings/bulk-upsert', async (req, res) => {
  try {
    const entries = Array.isArray(req.body?.listings) ? req.body.listings : null;
    if (!entries) {
      return res.status(400).json({ error: 'listings must be an array' });
    }

    const createdIds = [];
    const updatedIds = [];
    const rows = await sequelize.transaction(async (transaction) => {
      const out = [];
      for (const entry of entries) {
        const payload = buildListingPayload(entry || {}, { requireCreateFields: true });
        const { row, created } = await upsertListing(payload, transaction);
        out.push(row);
        if (created) createdIds.push(row.id);
        else updatedIds.push(row.id);
      }
      return out;
    });

    res.json({
      count: rows.length,
      createdCount: createdIds.length,
      updatedCount: updatedIds.length,
      listings: rows
    });
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market bulk upsert listings failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.delete('/listings/:id', async (req, res) => {
  try {
    const id = parseInteger(req.params.id, 'id', { allowNull: false, min: 1 });
    const deleted = await FleaMarketListing.destroy({ where: { id } });
    if (!deleted) return res.sendStatus(404);
    res.sendStatus(204);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market delete listing failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.get('/accounts', async (req, res) => {
  try {
    const username = normalizeText(req.query.username);
    const where = username ? { username } : undefined;
    const rows = await FleaMarketAccount.findAll({
      where,
      order: [['username', 'ASC']]
    });
    res.json(rows.map((row) => sanitizeAccount(row)));
  } catch (err) {
    logger.error('flea-market list accounts failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: err.message });
  }
});

router.get('/accounts/:username', async (req, res) => {
  try {
    const username = normalizeText(req.params.username);
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    const row = await FleaMarketAccount.findByPk(username);
    if (!row) return res.sendStatus(404);
    res.json(sanitizeAccount(row));
  } catch (err) {
    logger.error('flea-market get account failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: err.message });
  }
});

router.put('/accounts/:username', async (req, res) => {
  try {
    const username = normalizeText(req.params.username);
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    const payload = buildAccountPayload({ ...(req.body || {}), username }, { requireUsername: true });
    const { row } = await upsertAccount(payload, null);
    res.json(row);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market put account failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.post('/accounts/upsert', async (req, res) => {
  try {
    const payload = buildAccountPayload(req.body || {}, { requireUsername: true });
    const { row, created } = await upsertAccount(payload, null);
    res.status(created ? 201 : 200).json(row);
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market upsert account failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.post('/accounts/bulk-upsert', async (req, res) => {
  try {
    const entries = Array.isArray(req.body?.accounts) ? req.body.accounts : null;
    if (!entries) {
      return res.status(400).json({ error: 'accounts must be an array' });
    }

    const rows = await sequelize.transaction(async (transaction) => {
      const out = [];
      for (const entry of entries) {
        const payload = buildAccountPayload(entry || {}, { requireUsername: true });
        const { row } = await upsertAccount(payload, transaction);
        out.push(row);
      }
      return out;
    });

    res.json({
      count: rows.length,
      accounts: rows
    });
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market bulk upsert accounts failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

router.delete('/accounts/:username', async (req, res) => {
  try {
    const username = normalizeText(req.params.username);
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    const deleted = await FleaMarketAccount.destroy({ where: { username } });
    if (!deleted) return res.sendStatus(404);
    res.sendStatus(204);
  } catch (err) {
    logger.error('flea-market delete account failed', {
      ...requestContext(req),
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const listingEntries = Array.isArray(req.body?.listings) ? req.body.listings : [];
    const accountEntries = Array.isArray(req.body?.accounts) ? req.body.accounts : [];

    const result = await sequelize.transaction(async (transaction) => {
      const listings = [];
      const accounts = [];

      for (const entry of listingEntries) {
        const payload = buildListingPayload(entry || {}, { requireCreateFields: true });
        const { row } = await upsertListing(payload, transaction);
        listings.push(row.id);
      }

      for (const entry of accountEntries) {
        const payload = buildAccountPayload(entry || {}, { requireUsername: true });
        const { row } = await upsertAccount(payload, transaction);
        accounts.push(row.username);
      }

      return {
        listingIds: listings,
        accountUsernames: accounts
      };
    });

    res.json({
      ok: true,
      listingsUpserted: result.listingIds.length,
      accountsUpserted: result.accountUsernames.length,
      listingIds: result.listingIds,
      accountUsernames: result.accountUsernames
    });
  } catch (err) {
    const statusCode = /required|must be/.test(err.message) ? 400 : 500;
    logger.error('flea-market sync failed', {
      ...requestContext(req),
      error: err.message,
      body: summarizeBody(req.body),
      stack: err.stack
    });
    res.status(statusCode).json({ error: err.message });
  }
});

export default router;
