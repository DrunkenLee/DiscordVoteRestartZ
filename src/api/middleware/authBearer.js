import jwt from 'jsonwebtoken';

const getJwtSecret = () => String(process.env.JWT_SECRET || '').trim();

const readBearerToken = (authorizationHeader) => {
  const value = String(authorizationHeader || '').trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
};

export const requireAuthBearer = (req, res, next) => {
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

    req.authUser = {
      id: userId,
      username: decoded?.username || null,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

