import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { UserDetail, USER_DETAIL_STATUSES } from '../../models/userDetail.js';
import { ZMUser } from '../../models/zmuser.js';
import { requireAuthBearer } from '../middleware/authBearer.js';
import { lookupWhitelistUserByUsername } from '../../services/whitelistDbLookup.js';
import { fetchOnlinePlayersViaSsh } from '../../services/gamePresenceLookup.js';

const router = express.Router();

const PROFILE_UPLOAD_DIR = path.resolve(process.cwd(), 'public', 'uploads', 'profile');
const PROFILE_UPLOAD_URL_PREFIX = '/uploads/profile';
const PROFILE_AVATAR_MAX_BYTES = Number(process.env.PROFILE_AVATAR_MAX_BYTES || 5 * 1024 * 1024);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const STATUS_META = {
  idle: { key: 'idle', label: 'Idle', icon: '🟡' },
  raiding: { key: 'raiding', label: 'Raiding', icon: '⚔️' },
  chilling: { key: 'chilling', label: 'Chilling', icon: '🍃' },
};

const MAX_NICKNAME_LENGTH = 48;
const MAX_DESCRIPTION_LENGTH = 600;

const toStatusMeta = (status) => STATUS_META[status] || STATUS_META.idle;

const normalizeStatus = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return USER_DETAIL_STATUSES.includes(normalized) ? normalized : null;
};

const normalizeTextField = (value, maxLength) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};

const buildAvatarUrl = (avatarPath, req) => {
  const normalized = String(avatarPath || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }

  const host = String(req.get('host') || '').trim();
  if (!host) return normalized;
  return `${req.protocol}://${host}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
};

const toPublicDetail = (detail, req) => {
  if (!detail) return null;
  const raw = typeof detail.toJSON === 'function' ? detail.toJSON() : { ...detail };
  const statusMeta = toStatusMeta(raw.status);

  return {
    id: raw.id,
    userId: raw.userId,
    nickname: raw.nickname || null,
    status: statusMeta.key,
    statusLabel: statusMeta.label,
    statusIcon: statusMeta.icon,
    description: raw.description || null,
    avatarPath: raw.avatarPath || null,
    avatarUrl: buildAvatarUrl(raw.avatarPath, req),
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
};

const removeAvatarFileByPath = async (avatarPath) => {
  const normalizedPath = String(avatarPath || '').replace(/\\/g, '/');
  if (!normalizedPath || !normalizedPath.startsWith(PROFILE_UPLOAD_URL_PREFIX)) {
    return;
  }

  const filename = path.basename(normalizedPath);
  if (!filename || filename.includes('..')) return;

  const absolutePath = path.resolve(PROFILE_UPLOAD_DIR, filename);
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const ensureUserExists = async (userId) => {
  const user = await ZMUser.findByPk(userId);
  return Boolean(user);
};

const findOrCreateDetailForUser = async (userId) => {
  const [detail] = await UserDetail.findOrCreate({
    where: { userId },
    defaults: { userId, status: 'idle' },
  });
  return detail;
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(PROFILE_UPLOAD_DIR, { recursive: true })
      .then(() => cb(null, PROFILE_UPLOAD_DIR))
      .catch((error) => cb(error));
  },
  filename: (req, file, cb) => {
    const ext = String(path.extname(file.originalname || '') || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.png';
    cb(null, `${Date.now()}-${randomUUID()}${safeExt}`);
  },
});

const uploadAvatar = multer({
  storage,
  limits: {
    fileSize: PROFILE_AVATAR_MAX_BYTES,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WEBP, and GIF images are allowed.'));
      return;
    }
    cb(null, true);
  },
});

const uploadAvatarMiddleware = (req, res, next) => {
  uploadAvatar.single('avatar')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      const maxMb = Math.max(1, Math.round(PROFILE_AVATAR_MAX_BYTES / (1024 * 1024)));
      res.status(400).json({ error: `Avatar file is too large. Maximum allowed is ${maxMb}MB.` });
      return;
    }

    res.status(400).json({ error: error.message || 'Avatar upload failed.' });
  });
};

const upsertUserDetail = async (req, res) => {
  try {
    const userId = Number(req.authUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    if (!(await ensureUserExists(userId))) {
      return res.status(404).json({ error: 'Authenticated user does not exist.' });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'nickname')) {
      updates.nickname = normalizeTextField(req.body.nickname, MAX_NICKNAME_LENGTH);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      updates.description = normalizeTextField(req.body.description, MAX_DESCRIPTION_LENGTH);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      const normalizedStatus = normalizeStatus(req.body.status);
      if (!normalizedStatus) {
        return res.status(400).json({
          error: `Invalid status. Allowed values: ${USER_DETAIL_STATUSES.join(', ')}.`,
        });
      }
      updates.status = normalizedStatus;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'No valid fields provided. Allowed: nickname, description, status.',
      });
    }

    const detail = await findOrCreateDetailForUser(userId);
    await detail.update(updates);

    return res.json({
      detail: toPublicDetail(detail, req),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

router.get('/statuses', (req, res) => {
  const statuses = USER_DETAIL_STATUSES.map((status) => toStatusMeta(status));
  res.json({ statuses });
});

router.post('/me/sync-game-status', requireAuthBearer, async (req, res) => {
  try {
    const userId = Number(req.authUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const user = await ZMUser.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Authenticated user does not exist.' });
    }

    const usernameCandidates = [
      String(user.username1 || '').trim(),
      String(user.username2 || '').trim(),
    ].filter(Boolean);

    if (!usernameCandidates.length) {
      return res.status(400).json({
        error: 'No registered whitelist username found on account. Please complete registration first.',
      });
    }

    const detail = await findOrCreateDetailForUser(userId);
    const presenceResult = await fetchOnlinePlayersViaSsh();
    if (!presenceResult.ok) {
      return res.status(502).json({
        error: presenceResult.error || 'Failed to sync game online status.',
      });
    }

    const onlineByLower = new Map(
      presenceResult.players.map((name) => [String(name).toLowerCase(), name]),
    );
    const matchedUsername = usernameCandidates.find((candidate) => onlineByLower.has(candidate.toLowerCase())) || null;
    const isOnline = Boolean(matchedUsername);

    const primaryUsername = usernameCandidates[0];
    const whitelistLookup = await lookupWhitelistUserByUsername(primaryUsername);
    const whitelistError = whitelistLookup?.error || null;
    const isWhitelisted = Boolean(whitelistLookup?.found && !whitelistError);

    return res.json({
      checkedAt: new Date().toISOString(),
      user: {
        id: user.id ?? user.userid,
        username1: user.username1 || null,
        username2: user.username2 || null,
        discordid: user.discordid || null,
      },
      detail: toPublicDetail(detail, req),
      whitelist: {
        checkedUsername: primaryUsername,
        isWhitelisted,
        error: whitelistError,
        metadata: whitelistLookup?.metadata || null,
      },
      gamePresence: {
        state: isOnline ? 'online' : 'offline',
        isOnline,
        matchedUsername: matchedUsername || null,
        playerCount: presenceResult.players.length,
        source: presenceResult.source || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/me', requireAuthBearer, async (req, res) => {
  try {
    const userId = Number(req.authUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    if (!(await ensureUserExists(userId))) {
      return res.status(404).json({ error: 'Authenticated user does not exist.' });
    }

    const detail = await findOrCreateDetailForUser(userId);
    return res.json({ detail: toPublicDetail(detail, req) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/me', requireAuthBearer, upsertUserDetail);
router.patch('/me', requireAuthBearer, upsertUserDetail);

router.post('/me/avatar', requireAuthBearer, uploadAvatarMiddleware, async (req, res) => {
  try {
    const userId = Number(req.authUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    if (!(await ensureUserExists(userId))) {
      return res.status(404).json({ error: 'Authenticated user does not exist.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Missing avatar image file in field "avatar".' });
    }

    const detail = await findOrCreateDetailForUser(userId);
    const nextAvatarPath = `${PROFILE_UPLOAD_URL_PREFIX}/${req.file.filename}`.replace(/\\/g, '/');
    const previousAvatarPath = detail.avatarPath;

    await detail.update({ avatarPath: nextAvatarPath });
    if (previousAvatarPath && previousAvatarPath !== nextAvatarPath) {
      await removeAvatarFileByPath(previousAvatarPath);
    }

    return res.json({
      detail: toPublicDetail(detail, req),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/me/avatar', requireAuthBearer, async (req, res) => {
  try {
    const userId = Number(req.authUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const detail = await UserDetail.findOne({ where: { userId } });
    if (!detail) {
      return res.status(404).json({ error: 'Profile detail not found.' });
    }

    const previousAvatarPath = detail.avatarPath;
    await detail.update({ avatarPath: null });
    await removeAvatarFileByPath(previousAvatarPath);

    return res.json({
      detail: toPublicDetail(detail, req),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/me', requireAuthBearer, async (req, res) => {
  try {
    const userId = Number(req.authUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const detail = await UserDetail.findOne({ where: { userId } });
    if (!detail) {
      return res.status(404).json({ error: 'Profile detail not found.' });
    }

    await removeAvatarFileByPath(detail.avatarPath);
    await detail.destroy();
    return res.sendStatus(204);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:userId', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid userId.' });
    }

    const detail = await UserDetail.findOne({ where: { userId } });
    if (!detail) {
      return res.status(404).json({ error: 'Profile detail not found.' });
    }

    return res.json({ detail: toPublicDetail(detail, req) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
