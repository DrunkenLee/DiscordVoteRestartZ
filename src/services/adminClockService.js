import { AdminClockSession } from '../models/adminClockSession.js';

const DEFAULT_CONFIRM_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_CONFIRM_GRACE_MS = 10 * 60 * 1000;
const DEFAULT_CONFIRM_CHANNEL_ID = '1356957188895014962';

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeText = (value) => String(value ?? '').trim();

const LEGACY_SESSION_ATTRIBUTES = [
  'id',
  'discordUserId',
  'discordUsername',
  'discordDisplayName',
  'guildId',
  'clockInChannelId',
  'clockOutChannelId',
  'workDate',
  'clockInAt',
  'clockOutAt',
  'durationMinutes',
  'createdAt',
  'updatedAt',
];

const isMissingColumnError = (error) => {
  const message = String(
    error?.original?.message
      || error?.parent?.message
      || error?.message
      || '',
  ).toLowerCase();

  return error?.name === 'SequelizeDatabaseError'
    && message.includes('column')
    && message.includes('does not exist');
};

export const getAdminClockPolicy = () => {
  const confirmIntervalMs = toPositiveInt(
    process.env.ADMIN_CLOCK_CONFIRM_INTERVAL_MS,
    DEFAULT_CONFIRM_INTERVAL_MS,
  );
  const confirmGraceMs = toPositiveInt(
    process.env.ADMIN_CLOCK_CONFIRM_GRACE_MS,
    DEFAULT_CONFIRM_GRACE_MS,
  );

  return {
    confirmIntervalMs,
    confirmGraceMs,
    confirmationChannelId: normalizeText(process.env.ADMIN_CLOCK_CONFIRM_CHANNEL_ID) || DEFAULT_CONFIRM_CHANNEL_ID,
  };
};

export const getJakartaDateOnly = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

export const computeDurationMinutes = (clockInAt, clockOutAt = new Date()) => {
  const clockInMs = new Date(clockInAt).getTime();
  const clockOutMs = new Date(clockOutAt).getTime();
  if (!Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs)) return 0;
  return Math.max(0, Math.round((clockOutMs - clockInMs) / 60000));
};

export const buildNextConfirmationDueAt = (fromTime = new Date()) => {
  const { confirmIntervalMs } = getAdminClockPolicy();
  const baseMs = new Date(fromTime).getTime();
  return new Date(baseMs + confirmIntervalMs);
};

export const getOpenSessionByDiscordUserId = async (discordUserId) =>
  {
    const where = {
      discordUserId: normalizeText(discordUserId),
      clockOutAt: null,
    };

    try {
      return await AdminClockSession.findOne({
        where,
        order: [['clockInAt', 'DESC']],
      });
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }

      return AdminClockSession.findOne({
        attributes: LEGACY_SESSION_ATTRIBUTES,
        where,
        order: [['clockInAt', 'DESC']],
      });
    }
  };

export const getOpenAdminClockSessions = async () =>
  {
    try {
      return await AdminClockSession.findAll({
        where: { clockOutAt: null },
        order: [['clockInAt', 'ASC']],
      });
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }

      return AdminClockSession.findAll({
        attributes: LEGACY_SESSION_ATTRIBUTES,
        where: { clockOutAt: null },
        order: [['clockInAt', 'ASC']],
      });
    }
  };

export const createClockInSession = async ({
  discordUserId,
  discordUsername = null,
  discordDisplayName = null,
  guildId = null,
  clockInChannelId = null,
  source = 'discord',
}) => {
  const normalizedDiscordUserId = normalizeText(discordUserId);
  if (!normalizedDiscordUserId) {
    return { ok: false, reason: 'invalid_discord_user_id' };
  }

  const existingOpenSession = await getOpenSessionByDiscordUserId(normalizedDiscordUserId);
  if (existingOpenSession) {
    return { ok: false, reason: 'already_clocked_in', session: existingOpenSession };
  }

  const now = new Date();
  const fullPayload = {
    discordUserId: normalizedDiscordUserId,
    discordUsername: normalizeText(discordUsername) || null,
    discordDisplayName: normalizeText(discordDisplayName) || null,
    guildId: normalizeText(guildId) || null,
    clockInChannelId: normalizeText(clockInChannelId) || null,
    workDate: getJakartaDateOnly(now),
    clockInAt: now,
    lastConfirmationAt: now,
    nextConfirmationDueAt: buildNextConfirmationDueAt(now),
    lastConfirmationSource: normalizeText(source) || null,
    confirmationReminderSentAt: null,
    autoClockedOut: false,
    autoClockOutReason: null,
    autoClockOutBy: null,
  };

  const legacyPayload = {
    discordUserId: fullPayload.discordUserId,
    discordUsername: fullPayload.discordUsername,
    discordDisplayName: fullPayload.discordDisplayName,
    guildId: fullPayload.guildId,
    clockInChannelId: fullPayload.clockInChannelId,
    workDate: fullPayload.workDate,
    clockInAt: fullPayload.clockInAt,
  };

  try {
    const session = await AdminClockSession.create(fullPayload);

    return { ok: true, session };
  } catch (error) {
    // Guard against a race between pre-check and insert on the unique open-session index.
    if (error?.name === 'SequelizeUniqueConstraintError') {
      const racedOpenSession = await getOpenSessionByDiscordUserId(normalizedDiscordUserId);
      if (racedOpenSession) {
        return { ok: false, reason: 'already_clocked_in', session: racedOpenSession };
      }
    }

    // Backward compatibility for databases that haven't applied confirmation-field migration yet.
    if (isMissingColumnError(error)) {
      const legacySession = await AdminClockSession.create(legacyPayload);
      return { ok: true, session: legacySession };
    }

    throw error;
  }
};

export const closeClockSession = async (openSession, {
  clockOutAt = new Date(),
  clockOutChannelId = null,
  source = 'discord',
  autoClockedOut = false,
  autoClockOutReason = null,
  autoClockOutBy = null,
} = {}) => {
  const durationMinutes = computeDurationMinutes(openSession.clockInAt, clockOutAt);

  const fullUpdate = {
    clockOutAt,
    clockOutChannelId: normalizeText(clockOutChannelId) || null,
    durationMinutes,
    autoClockedOut: Boolean(autoClockedOut),
    autoClockOutReason: autoClockedOut ? (normalizeText(autoClockOutReason) || 'no_confirmation') : null,
    autoClockOutBy: autoClockedOut ? (normalizeText(autoClockOutBy) || 'system') : null,
    lastConfirmationSource: normalizeText(source) || openSession.lastConfirmationSource || null,
  };

  try {
    await openSession.update(fullUpdate);
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }

    await openSession.update({
      clockOutAt,
      clockOutChannelId: normalizeText(clockOutChannelId) || null,
      durationMinutes,
    });
  }

  return {
    session: openSession,
    clockOutAt,
    durationMinutes,
  };
};

export const closeClockSessionByDiscordUserId = async (discordUserId, options = {}) => {
  const openSession = await getOpenSessionByDiscordUserId(discordUserId);
  if (!openSession) {
    return { ok: false, reason: 'no_active_session' };
  }

  const result = await closeClockSession(openSession, options);
  return { ok: true, ...result };
};

export const confirmClockSessionByDiscordUserId = async (discordUserId, {
  source = 'discord',
  discordUsername = null,
  discordDisplayName = null,
} = {}) => {
  const openSession = await getOpenSessionByDiscordUserId(discordUserId);
  if (!openSession) {
    return { ok: false, reason: 'no_active_session' };
  }

  const now = new Date();
  const nextConfirmationDueAt = buildNextConfirmationDueAt(now);

  const updates = {
    lastConfirmationAt: now,
    nextConfirmationDueAt,
    confirmationReminderSentAt: null,
    lastConfirmationSource: normalizeText(source) || null,
  };

  const nextUsername = normalizeText(discordUsername);
  if (nextUsername) {
    updates.discordUsername = nextUsername;
  }
  const nextDisplayName = normalizeText(discordDisplayName);
  if (nextDisplayName) {
    updates.discordDisplayName = nextDisplayName;
  }

  try {
    await openSession.update(updates);
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }

    const legacyUpdates = {};
    if (nextUsername) {
      legacyUpdates.discordUsername = nextUsername;
    }
    if (nextDisplayName) {
      legacyUpdates.discordDisplayName = nextDisplayName;
    }
    if (Object.keys(legacyUpdates).length) {
      await openSession.update(legacyUpdates);
    }
  }

  return {
    ok: true,
    session: openSession,
    confirmedAt: now,
    nextConfirmationDueAt,
  };
};

const asDateOrNull = (value) => {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time);
};

const applyMissingConfirmationDefaults = async (session) => {
  const updates = {};
  const lastConfirmationAt = asDateOrNull(session.lastConfirmationAt) || asDateOrNull(session.clockInAt) || new Date();
  const nextConfirmationDueAt = asDateOrNull(session.nextConfirmationDueAt)
    || buildNextConfirmationDueAt(lastConfirmationAt);

  if (!asDateOrNull(session.lastConfirmationAt)) {
    updates.lastConfirmationAt = lastConfirmationAt;
  }
  if (!asDateOrNull(session.nextConfirmationDueAt)) {
    updates.nextConfirmationDueAt = nextConfirmationDueAt;
  }
  if (!Object.prototype.hasOwnProperty.call(session, 'confirmationReminderSentAt')) {
    updates.confirmationReminderSentAt = null;
  }

  if (Object.keys(updates).length) {
    try {
      await session.update(updates);
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }
    }
  }

  return {
    lastConfirmationAt,
    nextConfirmationDueAt,
    confirmationReminderSentAt: asDateOrNull(session.confirmationReminderSentAt),
  };
};

export const runAdminClockConfirmationSweep = async ({
  now = new Date(),
  onReminderNeeded = null,
  onAutoClockOut = null,
} = {}) => {
  const policy = getAdminClockPolicy();
  const sessions = await getOpenAdminClockSessions();

  const reminders = [];
  const autoClockedOut = [];

  for (const session of sessions) {
    // Legacy schema fallback: skip confirmation automation when confirmation columns are unavailable.
    const hasConfirmationColumns = session.nextConfirmationDueAt !== undefined
      || session.lastConfirmationAt !== undefined;
    if (!hasConfirmationColumns) {
      continue;
    }

    const {
      nextConfirmationDueAt,
      confirmationReminderSentAt,
    } = await applyMissingConfirmationDefaults(session);

    const overdueMs = now.getTime() - nextConfirmationDueAt.getTime();
    if (overdueMs < 0) {
      continue;
    }

    if (overdueMs >= policy.confirmGraceMs) {
      const closed = await closeClockSession(session, {
        clockOutAt: now,
        clockOutChannelId: policy.confirmationChannelId,
        source: 'system:auto_clockout',
        autoClockedOut: true,
        autoClockOutReason: 'no_confirmation',
        autoClockOutBy: 'system',
      });

      const payload = {
        session: closed.session,
        clockOutAt: closed.clockOutAt,
        durationMinutes: closed.durationMinutes,
        overdueMs,
        nextConfirmationDueAt,
      };
      autoClockedOut.push(payload);

      if (typeof onAutoClockOut === 'function') {
        await onAutoClockOut(payload);
      }
      continue;
    }

    if (!confirmationReminderSentAt) {
      try {
        await session.update({
          confirmationReminderSentAt: now,
        });
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }
      }

      const payload = {
        session,
        remindedAt: now,
        nextConfirmationDueAt,
        graceDeadlineAt: new Date(nextConfirmationDueAt.getTime() + policy.confirmGraceMs),
      };
      reminders.push(payload);

      if (typeof onReminderNeeded === 'function') {
        await onReminderNeeded(payload);
      }
    }
  }

  return {
    scanned: sessions.length,
    reminders,
    autoClockedOut,
    checkedAt: now.toISOString(),
    policy,
  };
};
