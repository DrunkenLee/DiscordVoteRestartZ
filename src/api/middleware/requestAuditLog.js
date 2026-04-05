import logger from '../../utils/logger.js';

function generateRequestId(req) {
  const headerId = req && req.headers ? req.headers['x-request-id'] : null;
  if (typeof headerId === 'string') {
    const trimmed = headerId.trim();
    if (trimmed !== '') return trimmed;
  }

  return `api_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function estimateBodyBytes(body) {
  if (body == null) return 0;

  if (typeof body === 'string') {
    return Buffer.byteLength(body);
  }

  try {
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    return 0;
  }
}

export function apiRequestAuditLog(req, res, next) {
  const requestId = generateRequestId(req);
  const startedAt = Date.now();
  const method = req.method || 'UNKNOWN';
  const path = req.originalUrl || req.url || '';
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const bodyBytes = estimateBodyBytes(req.body);
  const queryCount = req.query && typeof req.query === 'object' ? Object.keys(req.query).length : 0;

  res.setHeader('X-Request-Id', requestId);

  console.log(`[API][START] requestId=${requestId} method=${method} path=${path} ip=${ip} bodyBytes=${bodyBytes}`);
  logger.info('api request start', {
    requestId,
    method,
    path,
    ip,
    bodyBytes,
    queryCount
  });

  let done = false;
  const finishLog = (aborted) => {
    if (done) return;
    done = true;

    const durationMs = Date.now() - startedAt;
    const statusCode = Number(res.statusCode) || 0;
    const level = aborted || statusCode >= 500 ? 'error' : 'info';
    const state = aborted ? 'ABORTED' : 'END';
    const line = `[API][${state}] requestId=${requestId} method=${method} path=${path} status=${statusCode} durationMs=${durationMs}`;

    if (aborted || statusCode >= 500) {
      console.error(line);
    } else {
      console.log(line);
    }

    logger[level]('api request end', {
      requestId,
      method,
      path,
      statusCode,
      durationMs,
      aborted: aborted === true
    });
  };

  res.on('finish', () => finishLog(false));
  res.on('close', () => {
    if (!res.writableEnded) {
      finishLog(true);
    }
  });

  next();
}

