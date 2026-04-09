import { Op } from 'sequelize';
import { ZMUser } from '../models/zmuser.js';
import { verifyWhitelistCredentials } from './whitelistDbLookup.js';

const pickRowValue = (row, keys) => {
  if (!row || typeof row !== 'object') return null;

  const entries = Object.entries(row);
  for (const key of keys) {
    const match = entries.find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
    if (match && match[1] !== undefined && match[1] !== null && match[1] !== '') {
      return match[1];
    }
  }

  return null;
};

const normalizeText = (value) => String(value ?? '').trim();

const buildDiscordUsernameBase = ({ discordId, discordUsername, discordGlobalName, discordTag }) => {
  const preferredName = normalizeText(discordGlobalName)
    || normalizeText(discordUsername)
    || normalizeText(discordTag).split('#')[0]
    || 'player';

  const normalizedName = preferredName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'player';

  const shortId = normalizeText(discordId).slice(-6) || Date.now().toString().slice(-6);
  const maxBaseLength = 32;
  const trimmedName = normalizedName.slice(0, Math.max(1, maxBaseLength - shortId.length - 1));

  return `${trimmedName}_${shortId}`;
};

const findByUsernameInsensitive = async (usernameCandidate) => {
  const username = normalizeText(usernameCandidate);
  if (!username) return null;

  return ZMUser.findOne({
    where: {
      [Op.or]: [
        { username1: { [Op.iLike]: username } },
        { username2: { [Op.iLike]: username } },
      ],
    },
    order: [['updatedAt', 'DESC']],
  });
};

const ensureUniqueUsername = async (usernameCandidate, excludeUserId = null) => {
  const normalized = normalizeText(usernameCandidate) || `player_${Date.now()}`;
  let candidate = normalized;
  let attempt = 0;

  while (attempt < 1000) {
    const existing = await findByUsernameInsensitive(candidate);
    const existingId = existing?.id ?? existing?.userid ?? null;
    if (!existing || (excludeUserId !== null && String(existingId) === String(excludeUserId))) {
      return candidate;
    }

    attempt += 1;
    const suffix = `_${attempt}`;
    const base = normalized.slice(0, Math.max(1, 40 - suffix.length));
    candidate = `${base}${suffix}`;
  }

  return `${normalized.slice(0, 32)}_${Date.now().toString().slice(-6)}`;
};

const parseExtraData = (extraData) => {
  if (!extraData) return {};
  if (typeof extraData === 'object') return { ...extraData };

  if (typeof extraData === 'string') {
    try {
      const parsed = JSON.parse(extraData);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return { legacy: extraData };
    }
  }

  return {};
};

const sanitizeUser = (user) => {
  if (!user) return null;
  const userData = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
  delete userData.password1;
  delete userData.password2;
  return userData;
};

const findCandidateUser = async ({ discordId, discordTag, username }) => {
  const discordOrConditions = [
    discordId ? { discordid: discordId } : null,
    discordTag ? { discordid: discordTag } : null,
  ].filter(Boolean);

  if (discordOrConditions.length) {
    const byDiscord = await ZMUser.findOne({
      where: {
        [Op.or]: discordOrConditions,
      },
      order: [['updatedAt', 'DESC']],
    });
    if (byDiscord) return byDiscord;
  }

  const normalizedUsername = String(username ?? '').trim();
  if (!normalizedUsername) return null;

  return ZMUser.findOne({
    where: {
      username1: { [Op.iLike]: normalizedUsername },
    },
    order: [['updatedAt', 'DESC']],
  });
};

const buildRegistrationExtraData = (user, metadata) => {
  const current = parseExtraData(user?.extradata);
  const nowIso = new Date().toISOString();

  const authData = current.auth && typeof current.auth === 'object' ? current.auth : {};
  const registrationData =
    authData.registration && typeof authData.registration === 'object'
      ? authData.registration
      : {};

  return {
    ...current,
    source: current.source || 'discord-register',
    syncedAt: nowIso,
    auth: {
      ...authData,
      registration: {
        ...registrationData,
        registeredAt: nowIso,
        whitelistVerifiedAt: nowIso,
        whitelistDb: metadata,
      },
    },
  };
};

const buildDiscordOAuthExtraData = (user, {
  discordId,
  discordTag,
  discordUsername,
  discordGlobalName,
  discordAvatarUrl,
}) => {
  const current = parseExtraData(user?.extradata);
  const nowIso = new Date().toISOString();

  const authData = current.auth && typeof current.auth === 'object' ? current.auth : {};
  const oauthData = authData.oauth && typeof authData.oauth === 'object' ? authData.oauth : {};
  const oauthDiscord = oauthData.discord && typeof oauthData.discord === 'object' ? oauthData.discord : {};

  return {
    ...current,
    source: current.source || 'discord-oauth',
    syncedAt: nowIso,
    auth: {
      ...authData,
      oauth: {
        ...oauthData,
        provider: 'discord',
        linkedAt: oauthData.linkedAt || nowIso,
        lastLoginAt: nowIso,
        discord: {
          ...oauthDiscord,
          id: discordId,
          tag: discordTag || null,
          username: discordUsername || null,
          globalName: discordGlobalName || null,
          avatarUrl: discordAvatarUrl || null,
        },
      },
    },
  };
};

export const registerWhitelistUserCredentials = async ({
  username,
  password,
  discordId = null,
  discordTag = null,
}) => {
  const normalizedUsername = String(username ?? '').trim();
  const normalizedPassword = String(password ?? '');
  const normalizedDiscordId = String(discordId ?? '').trim() || null;
  const normalizedDiscordTag = String(discordTag ?? '').trim() || null;

  if (!normalizedUsername || !normalizedPassword) {
    return {
      ok: false,
      status: 400,
      error: 'Username and password are required.',
    };
  }

  if (!normalizedDiscordId && !normalizedDiscordTag) {
    return {
      ok: false,
      status: 400,
      error: 'discordId or discordTag is required. Register flow is tied to Discord identity.',
    };
  }

  const verification = await verifyWhitelistCredentials(normalizedUsername, normalizedPassword);
  if (!verification.ok) {
    return {
      ok: false,
      status: 500,
      error: verification.error || 'Failed to verify whitelist credentials.',
    };
  }

  if (!verification.found) {
    return {
      ok: false,
      status: 404,
      error: `Username "${normalizedUsername}" was not found in Project Zomboid whitelist DB.`,
    };
  }

  if (!verification.passwordMatches) {
    return {
      ok: false,
      status: 401,
      error: 'Password mismatch. Use the same password stored in Project Zomboid whitelist DB.',
    };
  }

  const targetUser = await findCandidateUser({
    discordId: normalizedDiscordId,
    discordTag: normalizedDiscordTag,
    username: normalizedUsername,
  });

  const steamidFromWhitelist = pickRowValue(verification.row, ['steamid', 'steam_id', 'steamid64']);
  const owneridFromWhitelist = pickRowValue(verification.row, ['ownerid', 'owner_id']);
  const metadata = verification.metadata || null;

  if (targetUser) {
    const mergedExtraData = buildRegistrationExtraData(targetUser, metadata);
    await targetUser.update({
      discordid: normalizedDiscordId || normalizedDiscordTag || targetUser.discordid,
      username1: normalizedUsername,
      password1: normalizedPassword,
      steamid: steamidFromWhitelist ? String(steamidFromWhitelist) : targetUser.steamid,
      ownerid: owneridFromWhitelist ? String(owneridFromWhitelist) : targetUser.ownerid,
      extradata: JSON.stringify(mergedExtraData),
    });

    return {
      ok: true,
      status: 200,
      user: sanitizeUser(targetUser),
      registrationMeta: metadata,
    };
  }

  const newUser = await ZMUser.create({
    discordid: normalizedDiscordId || normalizedDiscordTag,
    username1: normalizedUsername,
    password1: normalizedPassword,
    steamid: steamidFromWhitelist ? String(steamidFromWhitelist) : null,
    ownerid: owneridFromWhitelist ? String(owneridFromWhitelist) : null,
    username2: null,
    password2: null,
    extradata: JSON.stringify({
      source: 'discord-register',
      auth: {
        registration: {
          registeredAt: new Date().toISOString(),
          whitelistDb: metadata,
        },
      },
    }),
  });

  return {
    ok: true,
    status: 201,
    user: sanitizeUser(newUser),
    registrationMeta: metadata,
  };
};

export const registerDiscordOAuthUser = async ({
  discordId,
  discordTag = null,
  discordUsername = null,
  discordGlobalName = null,
  discordAvatarUrl = null,
}) => {
  const normalizedDiscordId = normalizeText(discordId);
  const normalizedDiscordTag = normalizeText(discordTag) || null;
  const normalizedDiscordUsername = normalizeText(discordUsername) || null;
  const normalizedDiscordGlobalName = normalizeText(discordGlobalName) || null;
  const normalizedDiscordAvatarUrl = normalizeText(discordAvatarUrl) || null;

  if (!normalizedDiscordId) {
    return {
      ok: false,
      status: 400,
      error: 'discordId is required.',
    };
  }

  const targetUser = await findCandidateUser({
    discordId: normalizedDiscordId,
    discordTag: normalizedDiscordTag,
    username: null,
  });

  const baseUsername = buildDiscordUsernameBase({
    discordId: normalizedDiscordId,
    discordUsername: normalizedDiscordUsername,
    discordGlobalName: normalizedDiscordGlobalName,
    discordTag: normalizedDiscordTag,
  });

  if (targetUser) {
    const mergedExtraData = buildDiscordOAuthExtraData(targetUser, {
      discordId: normalizedDiscordId,
      discordTag: normalizedDiscordTag,
      discordUsername: normalizedDiscordUsername,
      discordGlobalName: normalizedDiscordGlobalName,
      discordAvatarUrl: normalizedDiscordAvatarUrl,
    });

    const targetUserId = targetUser.id ?? targetUser.userid ?? null;
    const existingUsername = normalizeText(targetUser.username1);
    const ensuredUsername = existingUsername || await ensureUniqueUsername(baseUsername, targetUserId);

    await targetUser.update({
      discordid: normalizedDiscordId,
      username1: ensuredUsername,
      extradata: JSON.stringify(mergedExtraData),
    });

    return {
      ok: true,
      status: 200,
      user: sanitizeUser(targetUser),
      registrationMeta: {
        method: 'discord-oauth',
        created: false,
      },
    };
  }

  const uniqueUsername = await ensureUniqueUsername(baseUsername);
  const extraData = buildDiscordOAuthExtraData(null, {
    discordId: normalizedDiscordId,
    discordTag: normalizedDiscordTag,
    discordUsername: normalizedDiscordUsername,
    discordGlobalName: normalizedDiscordGlobalName,
    discordAvatarUrl: normalizedDiscordAvatarUrl,
  });

  const newUser = await ZMUser.create({
    discordid: normalizedDiscordId,
    username1: uniqueUsername,
    password1: null,
    steamid: null,
    ownerid: null,
    username2: null,
    password2: null,
    extradata: JSON.stringify(extraData),
  });

  return {
    ok: true,
    status: 201,
    user: sanitizeUser(newUser),
    registrationMeta: {
      method: 'discord-oauth',
      created: true,
    },
  };
};

export const toPublicUser = sanitizeUser;
