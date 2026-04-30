import express from 'express';
import path from 'path';
import { ZMUser } from '../../models/zmuser.js';
import { requireAuthBearer } from '../middleware/authBearer.js';
import { SftpLogReader } from '../../utils/sftpLogReader.js';
import logger from '../../utils/logger.js';

const router = express.Router();

const LOGS_DIR = '/home/pzserver/Zomboid/Logs';
const parsedMaxListResults = Number.parseInt(process.env.SERVER_LOGS_MAX_LIST_RESULTS || '500', 10);
const MAX_LIST_RESULTS = Number.isInteger(parsedMaxListResults) && parsedMaxListResults > 0
  ? parsedMaxListResults
  : 500;

const normalizeText = (value) => String(value ?? '').trim();
const normalizeAccessLevel = (value) => normalizeText(value).toLowerCase();
const isAdminAccessLevel = (value) => normalizeAccessLevel(value) === 'admin';

const normalizeListLimit = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.min(parsed, MAX_LIST_RESULTS);
};

const toPublicFileEntry = (entry) => {
  const sizeBytes = Number(entry?.size) || 0;
  const modifiedAtMs = Number(entry?.modifyTime) || 0;
  const modifiedAtIso = modifiedAtMs > 0 ? new Date(modifiedAtMs).toISOString() : null;

  return {
    name: String(entry?.name || ''),
    sizeBytes,
    modifiedAt: modifiedAtIso,
  };
};

const isSafeLogFileName = (fileName) => {
  const value = normalizeText(fileName);
  if (!value) return false;
  if (value.includes('/') || value.includes('\\')) return false;
  if (value.includes('\0')) return false;
  return value === path.posix.basename(value);
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
  if (!isAdminAccessLevel(req.authZmUser?.accesslevel)) {
    return res.status(403).json({ error: 'Admin access required (zmusers.accesslevel must be "admin").' });
  }
  return next();
};

router.get(
  '/files',
  requireAuthBearer,
  attachAuthUserRecord,
  requireAdminAccessLevel,
  async (req, res) => {
    const sftp = new SftpLogReader();
    const listLimit = normalizeListLimit(req.query.limit);

    try {
      await sftp.connect();
      const listing = await sftp.sftp.list(LOGS_DIR);

      const sortedFiles = listing
        .filter((entry) => entry?.type === '-')
        .sort((left, right) => (Number(right?.modifyTime) || 0) - (Number(left?.modifyTime) || 0));
      const files = listLimit
        ? sortedFiles.slice(0, listLimit).map(toPublicFileEntry)
        : sortedFiles.map(toPublicFileEntry);

      return res.json({
        ok: true,
        logDir: LOGS_DIR,
        count: files.length,
        maxResults: MAX_LIST_RESULTS,
        appliedLimit: listLimit,
        files,
      });
    } catch (error) {
      logger.error('[server-logs] list files failed', {
        userId: req.authZmUser?.id ?? null,
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).json({ error: `Failed to list server logs: ${error.message}` });
    } finally {
      await sftp.disconnect();
    }
  },
);

router.get(
  '/files/:fileName/download',
  requireAuthBearer,
  attachAuthUserRecord,
  requireAdminAccessLevel,
  async (req, res) => {
    const requestedFileName = normalizeText(req.params.fileName);
    if (!isSafeLogFileName(requestedFileName)) {
      return res.status(400).json({ error: 'Invalid file name.' });
    }

    const remotePath = path.posix.join(LOGS_DIR, requestedFileName);
    const sftp = new SftpLogReader();

    try {
      await sftp.connect();
      const stat = await sftp.sftp.stat(remotePath);
      const isDirectory = typeof stat?.isDirectory === 'function'
        ? stat.isDirectory()
        : Boolean(stat?.isDirectory);
      if (!stat || isDirectory) {
        return res.status(404).json({ error: 'Log file not found.' });
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(Number(stat.size) || 0));
      res.setHeader('Cache-Control', 'no-store');
      res.attachment(requestedFileName);

      await sftp.sftp.get(remotePath, res);
      return undefined;
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return undefined;
      }

      const statusCode = /no such file|not found/i.test(error.message) ? 404 : 500;
      logger.error('[server-logs] download file failed', {
        userId: req.authZmUser?.id ?? null,
        fileName: requestedFileName,
        error: error.message,
        stack: error.stack,
      });
      return res.status(statusCode).json({ error: `Failed to download log file: ${error.message}` });
    } finally {
      await sftp.disconnect();
    }
  },
);

export default router;
