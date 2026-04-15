import express from 'express';
import { Op } from 'sequelize';
import { AdminClockSession } from '../../models/adminClockSession.js';
import { ZMUser } from '../../models/zmuser.js';
import { requireAuthBearer } from '../middleware/authBearer.js';

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const JAKARTA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DEFAULT_HISTORY_DAYS = Number(process.env.ADMIN_CLOCK_DEFAULT_HISTORY_DAYS || 30);
const MAX_HISTORY_DAYS = Number(process.env.ADMIN_CLOCK_MAX_HISTORY_DAYS || 180);
const RECENT_SESSIONS_LIMIT = Number(process.env.ADMIN_CLOCK_RECENT_LIMIT || 120);

const normalizeText = (value) => String(value ?? '').trim();
const normalizeAccessLevel = (value) => normalizeText(value).toLowerCase();
const isAdminAccessLevel = (value) => normalizeAccessLevel(value) === 'admin';

const toJakartaDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return JAKARTA_DATE_FORMATTER.format(date);
};

const clampHistoryDays = (rawValue) => {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_HISTORY_DAYS;
  return Math.min(Math.max(parsed, 1), MAX_HISTORY_DAYS);
};

const buildDateRange = (days) => {
  const keys = [];
  const nowTs = Date.now();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = toJakartaDateKey(nowTs - (offset * DAY_MS));
    if (key) {
      keys.push(key);
    }
  }

  const fallbackKey = toJakartaDateKey(nowTs) || new Date(nowTs).toISOString().slice(0, 10);
  if (!keys.length) {
    keys.push(fallbackKey);
  }

  return {
    days,
    fromDate: keys[0],
    toDate: keys[keys.length - 1],
    keys,
  };
};

const computeSessionDurationMinutes = (session, nowTs = Date.now()) => {
  const explicitDuration = Number(session?.durationMinutes);
  if (Number.isFinite(explicitDuration) && explicitDuration >= 0) {
    return Math.round(explicitDuration);
  }

  const clockInMs = new Date(session?.clockInAt).getTime();
  if (!Number.isFinite(clockInMs)) {
    return 0;
  }

  const clockOutMsRaw = session?.clockOutAt ? new Date(session.clockOutAt).getTime() : nowTs;
  const clockOutMs = Number.isFinite(clockOutMsRaw) ? clockOutMsRaw : nowTs;
  return Math.max(0, Math.round((clockOutMs - clockInMs) / 60000));
};

const formatDurationLabel = (durationMinutes) => {
  const safeDuration = Math.max(0, Number(durationMinutes) || 0);
  const hours = Math.floor(safeDuration / 60);
  const minutes = safeDuration % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

const buildSessionDisplayName = (session) =>
  normalizeText(session?.discordDisplayName)
  || normalizeText(session?.discordUsername)
  || normalizeText(session?.discordUserId)
  || 'Unknown Admin';

const buildLinkedUsernamesByDiscordId = async (discordUserIds) => {
  const normalizedIds = [...new Set(discordUserIds.map((id) => normalizeText(id)).filter(Boolean))];
  const map = new Map();

  if (!normalizedIds.length) {
    return map;
  }

  const linkedUsers = await ZMUser.findAll({
    attributes: ['discordid', 'username1', 'username2'],
    where: {
      discordid: {
        [Op.in]: normalizedIds,
      },
    },
  });

  linkedUsers.forEach((user) => {
    const key = normalizeText(user.discordid);
    if (!key) return;

    const usernameCandidates = [normalizeText(user.username1), normalizeText(user.username2)].filter(Boolean);
    if (!usernameCandidates.length) return;

    const existing = map.get(key) || [];
    const deduped = [...new Set([...existing, ...usernameCandidates])];
    map.set(key, deduped);
  });

  return map;
};

const toPublicSession = (session, linkedUsernamesByDiscordId, nowTs) => {
  const discordUserId = normalizeText(session?.discordUserId);
  const linkedGameUsernames = linkedUsernamesByDiscordId.get(discordUserId) || [];
  const durationMinutes = computeSessionDurationMinutes(session, nowTs);
  const workDate = normalizeText(session?.workDate) || toJakartaDateKey(session?.clockInAt);

  return {
    id: session?.id ?? null,
    discordUserId: discordUserId || null,
    discordUsername: normalizeText(session?.discordUsername) || null,
    discordDisplayName: normalizeText(session?.discordDisplayName) || null,
    displayName: buildSessionDisplayName(session),
    workDate: workDate || null,
    clockInAt: session?.clockInAt || null,
    clockOutAt: session?.clockOutAt || null,
    isActive: !session?.clockOutAt,
    durationMinutes,
    durationLabel: formatDurationLabel(durationMinutes),
    linkedGameUsernames,
  };
};

const attachAuthUserRecord = async (req, res, next) => {
  try {
    const userId = Number(req.authUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const user = await ZMUser.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Authenticated user does not exist.' });
    }

    req.authZmUser = user;
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const requireAdminAccessLevel = (req, res, next) => {
  const accessLevel = req.authZmUser?.accesslevel;
  if (!isAdminAccessLevel(accessLevel)) {
    return res.status(403).json({ error: 'Admin access required (zmusers.accesslevel must be "admin").' });
  }

  return next();
};

router.get('/active-admins', requireAuthBearer, attachAuthUserRecord, async (_req, res) => {
  try {
    const openSessions = await AdminClockSession.findAll({
      where: { clockOutAt: null },
      order: [['clockInAt', 'ASC']],
    });

    const linkedUsernamesByDiscordId = await buildLinkedUsernamesByDiscordId(
      openSessions.map((session) => session.discordUserId),
    );
    const nowTs = Date.now();
    const activeAdmins = openSessions.map((session) =>
      toPublicSession(session, linkedUsernamesByDiscordId, nowTs));

    return res.json({
      checkedAt: new Date(nowTs).toISOString(),
      count: activeAdmins.length,
      activeAdmins,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/sessions', requireAuthBearer, attachAuthUserRecord, requireAdminAccessLevel, async (req, res) => {
  try {
    const historyDays = clampHistoryDays(req.query.days);
    const dateRange = buildDateRange(historyDays);
    const nowTs = Date.now();

    const sessions = await AdminClockSession.findAll({
      where: {
        workDate: {
          [Op.between]: [dateRange.fromDate, dateRange.toDate],
        },
      },
      order: [['clockInAt', 'DESC']],
    });

    const openSessions = await AdminClockSession.findAll({
      where: { clockOutAt: null },
      order: [['clockInAt', 'ASC']],
    });

    const allDiscordUserIds = [
      ...sessions.map((session) => session.discordUserId),
      ...openSessions.map((session) => session.discordUserId),
    ];
    const linkedUsernamesByDiscordId = await buildLinkedUsernamesByDiscordId(allDiscordUserIds);

    const publicSessions = sessions.map((session) => toPublicSession(session, linkedUsernamesByDiscordId, nowTs));
    const activeAdmins = openSessions.map((session) => toPublicSession(session, linkedUsernamesByDiscordId, nowTs));

    const trendBuckets = new Map(
      dateRange.keys.map((key) => [
        key,
        {
          date: key,
          totalMinutes: 0,
          totalSessions: 0,
          adminIds: new Set(),
        },
      ]),
    );

    const leaderboard = new Map();
    let totalMinutes = 0;

    publicSessions.forEach((session) => {
      const workDate = normalizeText(session.workDate);
      const safeMinutes = Math.max(0, Number(session.durationMinutes) || 0);
      totalMinutes += safeMinutes;

      if (workDate && trendBuckets.has(workDate)) {
        const bucket = trendBuckets.get(workDate);
        bucket.totalMinutes += safeMinutes;
        bucket.totalSessions += 1;
        if (session.discordUserId) {
          bucket.adminIds.add(session.discordUserId);
        }
      }

      const leaderboardKey = session.discordUserId || `unknown-${session.id}`;
      const existing = leaderboard.get(leaderboardKey) || {
        discordUserId: session.discordUserId,
        discordUsername: session.discordUsername,
        discordDisplayName: session.discordDisplayName,
        displayName: session.displayName,
        linkedGameUsernames: session.linkedGameUsernames || [],
        totalMinutes: 0,
        totalSessions: 0,
        activeSessions: 0,
        lastClockInAt: null,
        lastClockOutAt: null,
      };

      existing.totalMinutes += safeMinutes;
      existing.totalSessions += 1;
      if (session.isActive) {
        existing.activeSessions += 1;
      }

      const currentClockInMs = new Date(session.clockInAt).getTime();
      const previousClockInMs = new Date(existing.lastClockInAt).getTime();
      if (Number.isFinite(currentClockInMs) && (!Number.isFinite(previousClockInMs) || currentClockInMs > previousClockInMs)) {
        existing.lastClockInAt = session.clockInAt;
      }

      const currentClockOutMs = new Date(session.clockOutAt).getTime();
      const previousClockOutMs = new Date(existing.lastClockOutAt).getTime();
      if (Number.isFinite(currentClockOutMs) && (!Number.isFinite(previousClockOutMs) || currentClockOutMs > previousClockOutMs)) {
        existing.lastClockOutAt = session.clockOutAt;
      }

      leaderboard.set(leaderboardKey, existing);
    });

    activeAdmins.forEach((session) => {
      if (!session.discordUserId) return;

      const existing = leaderboard.get(session.discordUserId) || {
        discordUserId: session.discordUserId,
        discordUsername: session.discordUsername,
        discordDisplayName: session.discordDisplayName,
        displayName: session.displayName,
        linkedGameUsernames: session.linkedGameUsernames || [],
        totalMinutes: 0,
        totalSessions: 0,
        activeSessions: 0,
        lastClockInAt: null,
        lastClockOutAt: null,
      };
      existing.activeSessions += 1;
      if (!existing.lastClockInAt) {
        existing.lastClockInAt = session.clockInAt;
      }
      leaderboard.set(session.discordUserId, existing);
    });

    const trend = [...trendBuckets.values()].map((bucket) => ({
      date: bucket.date,
      totalMinutes: bucket.totalMinutes,
      totalHours: Number((bucket.totalMinutes / 60).toFixed(2)),
      sessionCount: bucket.totalSessions,
      adminCount: bucket.adminIds.size,
    }));

    const admins = [...leaderboard.values()]
      .map((item) => ({
        ...item,
        totalHours: Number((item.totalMinutes / 60).toFixed(2)),
      }))
      .sort((left, right) => {
        if (right.totalMinutes !== left.totalMinutes) {
          return right.totalMinutes - left.totalMinutes;
        }
        return String(left.displayName || '').localeCompare(String(right.displayName || ''), 'en', { sensitivity: 'base' });
      });

    const recentSessions = publicSessions.slice(0, Math.max(1, RECENT_SESSIONS_LIMIT));
    const totalSessions = publicSessions.length;
    const averageSessionMinutes = totalSessions > 0 ? Number((totalMinutes / totalSessions).toFixed(2)) : 0;

    return res.json({
      checkedAt: new Date(nowTs).toISOString(),
      viewer: {
        id: req.authZmUser?.id ?? req.authZmUser?.userid ?? null,
        username1: req.authZmUser?.username1 || null,
        accesslevel: req.authZmUser?.accesslevel || null,
      },
      range: {
        days: historyDays,
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
      },
      summary: {
        totalMinutes,
        totalHours: Number((totalMinutes / 60).toFixed(2)),
        totalSessions,
        averageSessionMinutes,
        adminCount: admins.length,
        activeAdminCount: activeAdmins.length,
      },
      trend,
      admins,
      activeAdmins,
      sessions: recentSessions,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
