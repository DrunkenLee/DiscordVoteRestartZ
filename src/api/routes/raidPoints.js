import express from 'express';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { Rcon } from 'rcon-client';
import { ZMUser } from '../../models/zmuser.js';
import { RaidPointTopup } from '../../models/raidPointTopup.js';
import { requireAuthBearer } from '../middleware/authBearer.js';
import logger from '../../utils/logger.js';

const router = express.Router();

const DEFAULT_AUTOGOPAY_BASE_URL = 'https://api-gopay.sawargipay.cloud';
const DEFAULT_IDR_PER_RAID_POINT = 2000;
const DEFAULT_AUTOGOPAY_TIMEOUT_MS = 12000;

const SUCCESS_PAYMENT_STATUS = 'paid';
const TERMINAL_PAYMENT_STATUSES = new Set(['paid', 'expired', 'cancelled']);
const TERMINAL_CREDIT_STATUSES = new Set(['success', 'failed']);
const REFRESH_QUERY_TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on']);

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parsePositiveInteger(value, fieldName) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return n;
}

function resolveIdrRate() {
  const parsed = Number.parseInt(String(process.env.RAID_POINT_IDR_RATE || DEFAULT_IDR_PER_RAID_POINT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_IDR_PER_RAID_POINT;
  }
  return parsed;
}

function resolveAutogopayTimeoutMs() {
  const parsed = Number.parseInt(String(process.env.AUTOGOPAY_TIMEOUT_MS || DEFAULT_AUTOGOPAY_TIMEOUT_MS), 10);
  if (!Number.isFinite(parsed) || parsed < 2000) {
    return DEFAULT_AUTOGOPAY_TIMEOUT_MS;
  }
  return parsed;
}

function resolveAutogopayBaseUrl() {
  const configured = normalizeText(process.env.AUTOGOPAY_BASE_URL);
  const candidate = configured || DEFAULT_AUTOGOPAY_BASE_URL;
  return candidate.replace(/\/+$/, '');
}

function getAutogopayApiKey() {
  return String(process.env.AUTOGOPAYKEY || '').trim();
}

function normalizeGatewayStatus(value) {
  const text = normalizeText(value);
  if (!text) return 'pending';
  const lowered = text.toLowerCase();

  if (lowered.includes('settlement') || lowered === 'paid' || lowered === 'success') return 'settlement';
  if (lowered.includes('expire')) return 'expire';
  if (lowered.includes('cancel')) return 'cancel';
  if (lowered.includes('pending')) return 'pending';
  return lowered;
}

function mapGatewayStatusToPaymentStatus(gatewayStatus, currentPaymentStatus = 'pending') {
  const normalized = normalizeGatewayStatus(gatewayStatus);
  if (normalized === 'settlement') return 'paid';
  if (normalized === 'expire') {
    return currentPaymentStatus === SUCCESS_PAYMENT_STATUS ? currentPaymentStatus : 'expired';
  }
  if (normalized === 'cancel') {
    return currentPaymentStatus === SUCCESS_PAYMENT_STATUS ? currentPaymentStatus : 'cancelled';
  }
  if (normalized === 'pending') return currentPaymentStatus;
  return currentPaymentStatus;
}

function parseGatewayDate(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const normalized = text.replace(' ', 'T');
  const withTimezone = /[zZ]|[+\-]\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}+07:00`;

  const parsed = new Date(withTimezone);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeSecret(value) {
  return String(value ?? '').replace(/^"|"$/g, '').trim();
}

function buildRconConfig() {
  const parsedTimeout = Number(process.env.RAID_POINT_RCON_TIMEOUT_MS || 10000);
  return {
    host: String(process.env.RCON_HOST || '').trim(),
    port: Number(process.env.RCON_PORT || 27015),
    password: normalizeSecret(process.env.RCON_PASSWORD),
    timeout: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 10000,
  };
}

function isRconConfigured(config) {
  return Boolean(config.host && config.password)
    && Number.isFinite(config.port)
    && config.port > 0;
}

function quoteRconArg(value) {
  const text = String(value ?? '');
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatClientExeUsernameArg(username) {
  const text = String(username ?? '').trim();
  if (!text) return '';
  return /\s/.test(text) ? quoteRconArg(text) : text;
}

async function sendRconCommand(command) {
  const rconConfig = buildRconConfig();
  if (!isRconConfigured(rconConfig)) {
    throw new Error('RCON_HOST/RCON_PORT/RCON_PASSWORD are not configured.');
  }

  let client = null;
  try {
    client = await Rcon.connect(rconConfig);
    return await client.send(command);
  } finally {
    if (client) {
      await client.end().catch(() => {});
    }
  }
}

function resolveAuthUsernames(user) {
  if (!user) return [];
  const candidates = [user.username1, user.username2]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return [...new Set(candidates)];
}

function resolveSelectedUsername(candidates, preferredUsername) {
  const preferred = normalizeText(preferredUsername);
  if (!preferred) return candidates[0] || null;

  const match = candidates.find((candidate) => candidate.toLowerCase() === preferred.toLowerCase());
  return match || null;
}

function readSignatureHeader(req) {
  const raw = req.headers['x-signature'];
  if (Array.isArray(raw)) {
    return normalizeText(raw[0]);
  }
  return normalizeText(raw);
}

function verifyCallbackSignature({ rawPayload, signature, secret }) {
  const normalizedSignature = normalizeText(signature)?.toLowerCase();
  if (!normalizedSignature || !secret) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawPayload)
    .digest('hex')
    .toLowerCase();

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(normalizedSignature, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function createHttpError(message, status = 500, payload = null) {
  const error = new Error(message);
  error.status = status;
  if (payload !== null) error.payload = payload;
  return error;
}

async function autogopayPost(endpointPath, body) {
  const apiKey = getAutogopayApiKey();
  if (!apiKey) {
    throw createHttpError('AUTOGOPAYKEY is missing on server.', 500);
  }

  const timeoutMs = resolveAutogopayTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  const baseUrl = resolveAutogopayBaseUrl();
  const url = `${baseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: body ? JSON.stringify(body) : '{}',
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      const message = normalizeText(payload?.message) || `AutoGoPay request failed (${response.status}).`;
      throw createHttpError(message, 502, payload);
    }

    return payload;
  } catch (error) {
    if (error?.status) throw error;
    throw createHttpError(`AutoGoPay request failed: ${error.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

function toPublicTopup(topup) {
  const row = typeof topup?.toJSON === 'function' ? topup.toJSON() : topup;
  if (!row) return null;

  const paymentTerminal = TERMINAL_PAYMENT_STATUSES.has(String(row.paymentStatus || '').toLowerCase());
  const creditTerminal = TERMINAL_CREDIT_STATUSES.has(String(row.creditStatus || '').toLowerCase());

  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    raidPoints: row.raidPoints,
    amount: row.amount,
    idrPerRaidPoint: row.idrPerRaidPoint,
    paymentStatus: row.paymentStatus,
    autogopayStatus: row.autogopayStatus,
    creditStatus: row.creditStatus,
    gatewayMessage: row.gatewayMessage || null,
    qrUrl: row.qrUrl || null,
    qrString: row.qrString || null,
    autogopayTransactionId: row.autogopayTransactionId,
    autogopayOrderId: row.autogopayOrderId || null,
    transactionTime: row.transactionTime || null,
    expiryTime: row.expiryTime || null,
    paidAt: row.paidAt || null,
    creditedAt: row.creditedAt || null,
    lastStatusCheckedAt: row.lastStatusCheckedAt || null,
    callbackVerified: Boolean(row.callbackVerified),
    callbackEvent: row.callbackEvent || null,
    creditError: row.creditError || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    isTerminal: paymentTerminal && (row.paymentStatus !== SUCCESS_PAYMENT_STATUS || creditTerminal),
  };
}

async function findAuthenticatedUser(req) {
  const userId = Number(req.authUser?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createHttpError('Invalid auth user id.', 401);
  }

  const user = await ZMUser.findByPk(userId);
  if (!user) {
    throw createHttpError('Authenticated user does not exist.', 404);
  }

  return user;
}

async function creditTopupIfNeeded(topupId, source = 'unknown') {
  let topup = await RaidPointTopup.findByPk(topupId);
  if (!topup) return { ok: false, reason: 'not_found' };

  if (topup.creditedAt || String(topup.creditStatus || '').toLowerCase() === 'success') {
    return { ok: true, alreadyCredited: true, topup };
  }
  if (String(topup.paymentStatus || '').toLowerCase() !== SUCCESS_PAYMENT_STATUS) {
    return { ok: false, reason: 'payment_not_settled', topup };
  }

  const [claimedCount] = await RaidPointTopup.update(
    {
      creditStatus: 'processing',
      creditError: null,
    },
    {
      where: {
        id: topup.id,
        creditedAt: null,
        paymentStatus: SUCCESS_PAYMENT_STATUS,
        creditStatus: { [Op.in]: ['pending', 'failed'] },
      },
    }
  );

  if (!claimedCount) {
    topup = await RaidPointTopup.findByPk(topupId);
    return { ok: true, inFlight: true, topup };
  }

  try {
    const targetArg = formatClientExeUsernameArg(topup.username);
    if (!targetArg) {
      throw new Error('Resolved username is invalid for client executor dispatch.');
    }

    const amount = Number(topup.raidPoints || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Raid point amount is invalid.');
    }

    const command = `luacmd clientexe ${targetArg} addskinpoint ${targetArg} ${amount}`;
    const rconResponse = await sendRconCommand(command);
    await RaidPointTopup.update(
      {
        creditStatus: 'success',
        creditedAt: new Date(),
        creditError: null,
      },
      { where: { id: topup.id } }
    );

    logger.info('raid-point topup credited', {
      topupId: String(topup.id),
      userId: String(topup.userId),
      username: topup.username,
      raidPoints: topup.raidPoints,
      source,
      rconResponsePreview: String(rconResponse || '').slice(0, 260),
    });
  } catch (error) {
    await RaidPointTopup.update(
      {
        creditStatus: 'failed',
        creditError: String(error?.message || error || 'Unknown credit failure.').slice(0, 1000),
      },
      { where: { id: topup.id } }
    );

    logger.error('raid-point topup credit failed', {
      topupId: String(topup.id),
      userId: String(topup.userId),
      username: topup.username,
      raidPoints: topup.raidPoints,
      source,
      error: error?.message,
      stack: error?.stack,
    });
  }

  topup = await RaidPointTopup.findByPk(topupId);
  return { ok: true, topup };
}

async function applyGatewayStatusToTopup(topup, {
  gatewayStatus,
  gatewayMessage = null,
  gatewayPayload = undefined,
  callbackVerified = undefined,
  callbackEvent = undefined,
  callbackPayload = undefined,
  transactionTime = undefined,
  expiryTime = undefined,
  markStatusChecked = false,
  creditSource = 'gateway_update',
}) {
  const currentPaymentStatus = String(topup.paymentStatus || 'pending').toLowerCase();
  const normalizedGatewayStatus = normalizeGatewayStatus(gatewayStatus);
  const nextPaymentStatus = mapGatewayStatusToPaymentStatus(normalizedGatewayStatus, currentPaymentStatus);

  const updates = {
    autogopayStatus: normalizedGatewayStatus,
    paymentStatus: nextPaymentStatus,
    gatewayMessage: normalizeText(gatewayMessage),
  };

  if (gatewayPayload !== undefined) {
    updates.gatewayPayload = gatewayPayload;
  }
  if (callbackVerified !== undefined) {
    updates.callbackVerified = Boolean(callbackVerified);
  }
  if (callbackEvent !== undefined) {
    updates.callbackEvent = normalizeText(callbackEvent);
  }
  if (callbackPayload !== undefined) {
    updates.callbackPayload = callbackPayload;
  }
  if (transactionTime !== undefined) {
    updates.transactionTime = transactionTime;
  }
  if (expiryTime !== undefined) {
    updates.expiryTime = expiryTime;
  }
  if (markStatusChecked) {
    updates.lastStatusCheckedAt = new Date();
  }
  if (nextPaymentStatus === SUCCESS_PAYMENT_STATUS && !topup.paidAt) {
    updates.paidAt = new Date();
  }

  await topup.update(updates);
  let refreshed = await RaidPointTopup.findByPk(topup.id);

  if (refreshed && String(refreshed.paymentStatus || '').toLowerCase() === SUCCESS_PAYMENT_STATUS) {
    await creditTopupIfNeeded(refreshed.id, creditSource);
    refreshed = await RaidPointTopup.findByPk(topup.id);
  }

  return refreshed;
}

router.get('/', (_req, res) => {
  res.json({
    service: 'raid-points',
    ok: true,
    routes: {
      topups: [
        'POST /topups',
        'GET /topups/:id?refresh=true',
        'POST /topups/:id/cancel',
      ],
      callback: [
        'POST /autogopay-callback',
      ],
    },
  });
});

router.post('/topups', requireAuthBearer, async (req, res) => {
  try {
    const user = await findAuthenticatedUser(req);
    const raidPoints = parsePositiveInteger(req.body?.raidPoints, 'raidPoints');
    const idrPerRaidPoint = resolveIdrRate();
    const amount = raidPoints * idrPerRaidPoint;

    const usernames = resolveAuthUsernames(user);
    if (!usernames.length) {
      throw createHttpError('No whitelist username linked to your account.', 400);
    }

    const selectedUsername = resolveSelectedUsername(usernames, req.body?.username);
    if (!selectedUsername) {
      throw createHttpError('Selected username is not linked to your account.', 400);
    }

    const gatewayResponse = await autogopayPost('/qris/generate', { amount });
    const gatewayData = gatewayResponse?.data && typeof gatewayResponse.data === 'object'
      ? gatewayResponse.data
      : {};

    const autogopayTransactionId = normalizeText(
      gatewayData.transaction_id
      || gatewayData.id
      || gatewayData.transactionId
    );
    if (!autogopayTransactionId) {
      throw createHttpError('AutoGoPay response missing transaction_id.', 502, gatewayResponse);
    }

    const gatewayStatus = normalizeGatewayStatus(gatewayData.transaction_status || gatewayData.status || 'pending');
    const paymentStatus = mapGatewayStatusToPaymentStatus(gatewayStatus, 'pending');
    const transactionTime = parseGatewayDate(gatewayData.transaction_time);
    const expiryTime = parseGatewayDate(gatewayData.expiry_time);

    let topup = await RaidPointTopup.create({
      userId: user.id ?? user.userid,
      username: selectedUsername,
      raidPoints,
      amount,
      idrPerRaidPoint,
      autogopayTransactionId,
      autogopayOrderId: normalizeText(gatewayData.order_id),
      autogopayStatus: gatewayStatus,
      paymentStatus,
      creditStatus: 'pending',
      gatewayMessage: normalizeText(gatewayResponse?.message),
      qrUrl: normalizeText(gatewayData.qr_url),
      qrString: normalizeText(gatewayData.qr_string),
      transactionTime,
      expiryTime,
      paidAt: paymentStatus === SUCCESS_PAYMENT_STATUS ? new Date() : null,
      gatewayPayload: gatewayResponse,
      lastStatusCheckedAt: new Date(),
    });

    if (paymentStatus === SUCCESS_PAYMENT_STATUS) {
      await creditTopupIfNeeded(topup.id, 'create_topup_settlement');
      topup = await RaidPointTopup.findByPk(topup.id);
    }

    return res.status(201).json({
      ok: true,
      topup: toPublicTopup(topup),
    });
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    logger.error('raid-point create topup failed', {
      statusCode,
      userId: req.authUser?.id || null,
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
      error: error.message,
      stack: error.stack,
    });
    return res.status(statusCode).json({
      error: error.message,
      details: error?.payload || null,
    });
  }
});

router.get('/topups/:id', requireAuthBearer, async (req, res) => {
  try {
    const user = await findAuthenticatedUser(req);
    const id = parsePositiveInteger(req.params.id, 'id');
    const topup = await RaidPointTopup.findByPk(id);
    if (!topup || Number(topup.userId) !== Number(user.id ?? user.userid)) {
      return res.status(404).json({ error: 'Topup not found.' });
    }

    const refreshRaw = String(req.query?.refresh || '').toLowerCase().trim();
    const shouldRefresh = REFRESH_QUERY_TRUE_VALUES.has(refreshRaw);

    let refreshed = topup;
    if (shouldRefresh && String(topup.paymentStatus || '').toLowerCase() === 'pending') {
      const gatewayResponse = await autogopayPost('/qris/status', {
        transaction_id: topup.autogopayTransactionId,
      });

      const gatewayData = gatewayResponse?.data && typeof gatewayResponse.data === 'object'
        ? gatewayResponse.data
        : {};
      const gatewayStatus = normalizeGatewayStatus(
        gatewayData.transaction_status
        || gatewayData.status
        || gatewayResponse?.status
        || (gatewayResponse?.success ? 'settlement' : 'pending')
      );

      const transactionTime = parseGatewayDate(gatewayData.transaction_time);
      refreshed = await applyGatewayStatusToTopup(topup, {
        gatewayStatus,
        gatewayMessage: normalizeText(gatewayResponse?.message),
        gatewayPayload: gatewayResponse,
        transactionTime: transactionTime === null ? undefined : transactionTime,
        markStatusChecked: true,
        creditSource: 'status_poll',
      });
    }

    return res.json({
      ok: true,
      topup: toPublicTopup(refreshed),
    });
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    logger.error('raid-point get topup failed', {
      statusCode,
      userId: req.authUser?.id || null,
      topupId: req.params?.id || null,
      query: req.query || {},
      error: error.message,
      stack: error.stack,
    });
    return res.status(statusCode).json({
      error: error.message,
      details: error?.payload || null,
    });
  }
});

router.post('/topups/:id/cancel', requireAuthBearer, async (req, res) => {
  try {
    const user = await findAuthenticatedUser(req);
    const id = parsePositiveInteger(req.params.id, 'id');
    const topup = await RaidPointTopup.findByPk(id);
    if (!topup || Number(topup.userId) !== Number(user.id ?? user.userid)) {
      return res.status(404).json({ error: 'Topup not found.' });
    }

    if (String(topup.paymentStatus || '').toLowerCase() !== 'pending') {
      return res.status(409).json({
        error: 'Only pending topup can be cancelled.',
        topup: toPublicTopup(topup),
      });
    }

    const gatewayResponse = await autogopayPost('/qris/cancel', {
      transaction_id: topup.autogopayTransactionId,
    });

    const gatewayData = gatewayResponse?.data && typeof gatewayResponse.data === 'object'
      ? gatewayResponse.data
      : {};
    const gatewayStatus = normalizeGatewayStatus(
      gatewayData.transaction_status
      || gatewayData.status
      || 'cancel'
    );
    const transactionTime = parseGatewayDate(gatewayData.transaction_time);

    const refreshed = await applyGatewayStatusToTopup(topup, {
      gatewayStatus,
      gatewayMessage: normalizeText(gatewayResponse?.message),
      gatewayPayload: gatewayResponse,
      transactionTime: transactionTime === null ? undefined : transactionTime,
      markStatusChecked: true,
      creditSource: 'cancel_flow',
    });

    return res.json({
      ok: true,
      topup: toPublicTopup(refreshed),
    });
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    logger.error('raid-point cancel topup failed', {
      statusCode,
      userId: req.authUser?.id || null,
      topupId: req.params?.id || null,
      error: error.message,
      stack: error.stack,
    });
    return res.status(statusCode).json({
      error: error.message,
      details: error?.payload || null,
    });
  }
});

router.post('/autogopay-callback', async (req, res) => {
  try {
    const apiKey = getAutogopayApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'AUTOGOPAYKEY is missing on server.' });
    }

    const signature = readSignatureHeader(req);
    const rawPayload = typeof req.rawBody === 'string'
      ? req.rawBody
      : JSON.stringify(req.body || {});
    const signatureValid = verifyCallbackSignature({
      rawPayload,
      signature,
      secret: apiKey,
    });

    if (!signatureValid) {
      logger.warn('raid-point callback rejected: invalid signature', {
        signaturePresent: Boolean(signature),
        bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
      });
      return res.status(401).json({ error: 'Invalid signature.' });
    }

    const event = normalizeText(req.body?.event)?.toLowerCase() || null;
    if (event === 'verification.challenge') {
      return res.json({ success: true });
    }

    const transactionData = req.body?.transaction && typeof req.body.transaction === 'object'
      ? req.body.transaction
      : {};
    const transactionId = normalizeText(
      transactionData.id
      || transactionData.transaction_id
      || req.body?.transaction_id
    );
    if (!transactionId) {
      return res.status(400).json({ error: 'transaction.id is required.' });
    }

    const topup = await RaidPointTopup.findOne({
      where: { autogopayTransactionId: transactionId },
    });
    if (!topup) {
      logger.warn('raid-point callback unmatched transaction', {
        transactionId,
        event,
      });
      return res.json({
        success: true,
        accepted: false,
        ignored: true,
        reason: 'transaction_not_registered',
      });
    }

    const gatewayStatus = normalizeGatewayStatus(
      transactionData.status
      || transactionData.transaction_status
      || req.body?.status
    );
    const transactionTime = parseGatewayDate(transactionData.time || transactionData.transaction_time);

    const refreshed = await applyGatewayStatusToTopup(topup, {
      gatewayStatus,
      gatewayMessage: normalizeText(req.body?.message),
      gatewayPayload: req.body,
      callbackVerified: true,
      callbackEvent: event,
      callbackPayload: req.body,
      transactionTime: transactionTime === null ? undefined : transactionTime,
      markStatusChecked: true,
      creditSource: 'webhook_callback',
    });

    logger.info('raid-point callback accepted', {
      topupId: String(topup.id),
      transactionId,
      event,
      gatewayStatus,
      paymentStatus: refreshed?.paymentStatus || topup.paymentStatus,
      creditStatus: refreshed?.creditStatus || topup.creditStatus,
    });

    return res.json({
      success: true,
      accepted: true,
      topupId: topup.id,
    });
  } catch (error) {
    logger.error('raid-point callback failed', {
      error: error.message,
      stack: error.stack,
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
    });
    return res.status(500).json({ error: error.message });
  }
});

export default router;
