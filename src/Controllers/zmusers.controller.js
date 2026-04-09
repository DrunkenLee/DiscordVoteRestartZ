import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { ZMUser } from '../models/zmuser.js';
import { Op } from 'sequelize';
import {
  registerDiscordOAuthUser,
  registerWhitelistUserCredentials,
  toPublicUser,
} from '../services/authRegistration.js';

const getJwtSecret = () => String(process.env.JWT_SECRET || '').trim();
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

const getDiscordOAuthConfig = () => ({
  clientId: String(process.env.DISCORD_OAUTH_CLIENT_ID || '').trim(),
  clientSecret: String(process.env.DISCORD_OAUTH_CLIENT_SECRET || '').trim(),
  redirectUri: String(process.env.DISCORD_OAUTH_REDIRECT_URI || '').trim(),
});

const readBearerToken = (authorizationHeader) => {
  const value = String(authorizationHeader || '').trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
};

const createAuthTokenPayload = ({ userId, username, jwtSecret }) =>
  jwt.sign(
    { id: userId, username },
    jwtSecret,
    { expiresIn: '1h' },
  );

const buildDiscordProfile = (profilePayload) => {
  const discriminator = String(profilePayload?.discriminator || '').trim();
  const username = String(profilePayload?.username || '');
  const tag = discriminator && discriminator !== '0'
    ? `${username}#${discriminator}`
    : username;

  const avatarUrl = profilePayload?.avatar
    ? `https://cdn.discordapp.com/avatars/${profilePayload.id}/${profilePayload.avatar}.png?size=128`
    : null;

  return {
    id: String(profilePayload.id),
    username,
    globalName: profilePayload.global_name || null,
    discriminator: discriminator || null,
    tag,
    avatarUrl,
  };
};

const exchangeCodeForDiscordProfile = async ({ code }) => {
  const { clientId, clientSecret, redirectUri } = getDiscordOAuthConfig();
  if (!clientId || !clientSecret || !redirectUri) {
    return {
      ok: false,
      status: 500,
      error: 'Discord OAuth is not configured. Missing DISCORD_OAUTH_CLIENT_ID, DISCORD_OAUTH_CLIENT_SECRET, or DISCORD_OAUTH_REDIRECT_URI.',
    };
  }

  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) {
    return {
      ok: false,
      status: 400,
      error: 'Missing OAuth code.',
    };
  }

  try {
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: normalizedCode,
      redirect_uri: redirectUri,
      scope: 'identify',
    });

    const tokenResponse = await fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString(),
    });

    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      const oauthError = tokenPayload?.error_description || tokenPayload?.error || 'OAuth token exchange failed.';
      return {
        ok: false,
        status: 400,
        error: oauthError,
      };
    }

    const profileResponse = await fetch(`${DISCORD_API_BASE_URL}/users/@me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });

    const profilePayload = await profileResponse.json().catch(() => ({}));
    if (!profileResponse.ok || !profilePayload?.id) {
      return {
        ok: false,
        status: 400,
        error: 'Failed to fetch Discord profile.',
      };
    }

    return {
      ok: true,
      status: 200,
      discord: buildDiscordProfile(profilePayload),
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error.message,
    };
  }
};

export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return res.status(500).json({ error: 'JWT_SECRET is missing on server.' });
  }

  try {
    const user = await ZMUser.findOne({
      where: {
        [Op.or]: [
          { username1: username },
          { username2: username }
        ],
        password1: password,
        accesslevel: null
      }
    });

    if (user) {
      const userId = user.id ?? user.userid;
      const token = jwt.sign({ id: userId, username: user.username1 }, jwtSecret, { expiresIn: '1h' });
      const userData = toPublicUser(user);
      res.json({ token, user: userData });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const register = async (req, res) => {
  const { username, password, discordId, discordTag } = req.body;

  try {
    const result = await registerWhitelistUserCredentials({
      username,
      password,
      discordId,
      discordTag,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return res.status(500).json({ error: 'JWT_SECRET is missing on server.' });
    }

    const userId = result.user?.id ?? result.user?.userid;
    const token = jwt.sign(
      { id: userId, username: result.user?.username1 || username },
      jwtSecret,
      { expiresIn: '1h' },
    );

    return res.status(result.status).json({
      token,
      user: result.user,
      registrationMeta: result.registrationMeta,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const registerWithDiscordOAuthCode = async (req, res) => {
  const code = String(req.body?.code || '').trim();

  try {
    const exchangeResult = await exchangeCodeForDiscordProfile({ code });
    if (!exchangeResult.ok) {
      return res.status(exchangeResult.status).json({ error: exchangeResult.error });
    }

    const discord = exchangeResult.discord;
    const result = await registerDiscordOAuthUser({
      discordId: discord.id,
      discordTag: discord.tag,
      discordUsername: discord.username,
      discordGlobalName: discord.globalName,
      discordAvatarUrl: discord.avatarUrl,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return res.status(500).json({ error: 'JWT_SECRET is missing on server.' });
    }

    const userId = result.user?.id ?? result.user?.userid;
    const token = createAuthTokenPayload({
      userId,
      username: result.user?.username1 || discord.username || discord.id,
      jwtSecret,
    });

    return res.status(result.status).json({
      token,
      user: result.user,
      discord,
      registrationMeta: result.registrationMeta,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const me = async (req, res) => {
  try {
    const token = readBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Missing Bearer token.' });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return res.status(500).json({ error: 'JWT_SECRET is missing on server.' });
    }

    const decoded = jwt.verify(token, jwtSecret);
    const userId = decoded?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const user = await ZMUser.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({ user: toPublicUser(user) });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

export const getDiscordOAuthUrl = async (req, res) => {
  const { clientId, redirectUri } = getDiscordOAuthConfig();
  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error: 'Discord OAuth is not configured. Missing DISCORD_OAUTH_CLIENT_ID or DISCORD_OAUTH_REDIRECT_URI.',
    });
  }

  const state = String(req.query.state || '').trim();
  const url = new URL(`${DISCORD_API_BASE_URL}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  if (state) {
    url.searchParams.set('state', state);
  }

  return res.json({
    url: url.toString(),
  });
};

export const exchangeDiscordOAuthCode = async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const exchangeResult = await exchangeCodeForDiscordProfile({ code });
  if (!exchangeResult.ok) {
    return res.status(exchangeResult.status).json({ error: exchangeResult.error });
  }

  return res.json({
    discord: exchangeResult.discord,
  });
};
