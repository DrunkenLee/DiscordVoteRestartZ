import express from 'express';
import path from 'path';
import { ZMUser } from '../../models/zmuser.js';
import { requireAuthBearer } from '../middleware/authBearer.js';
import { SftpLogReader } from '../../utils/sftpLogReader.js';
import logger from '../../utils/logger.js';

const router = express.Router();

const LOGS_DIR = '/home/pzserver/Zomboid/Logs';
const SPECIAL_LUA_LOG_FILES = [
  {
    name: 'FishingShopTransactions.log',
    displayName: 'Fish Selling Log',
    remotePath: '/home/pzserver/Zomboid/Lua/FishingShopTransactions.log',
  },
  {
    name: 'JewelryShopTransactions.log',
    displayName: 'Jewel Selling Log',
    remotePath: '/home/pzserver/Zomboid/Lua/JewelryShopTransactions.log',
  },
  {
    name: 'ZMLuckyDraw.log',
    displayName: 'LuckyDraw Log',
    remotePath: '/home/pzserver/Zomboid/Lua/ZMLuckyDraw.log',
  },
  {
    name: 'ServerPointxInfuseTicket.log',
    displayName: 'Ticket Infuse Log',
    remotePath: '/home/pzserver/Zomboid/Lua/ServerPointxInfuseTicket.log',
  },
];
const SPECIAL_LUA_LOGS_BY_NAME = new Map(
  SPECIAL_LUA_LOG_FILES.map((entry) => [String(entry.name || '').toLowerCase(), entry]),
);
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

const toIsoTimestamp = (value) => {
  const epoch = Number(value) || 0;
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  const epochMs = epoch < 1000000000000 ? epoch * 1000 : epoch;
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toPublicFileEntry = (entry) => {
  const sizeBytes = Number(entry?.size) || 0;

  return {
    name: String(entry?.name || ''),
    displayName: String(entry?.name || ''),
    sizeBytes,
    modifiedAt: toIsoTimestamp(entry?.modifyTime),
    exists: true,
    isSpecialLuaLog: false,
    missingReason: null,
  };
};

const isSafeLogFileName = (fileName) => {
  const value = normalizeText(fileName);
  if (!value) return false;
  if (value.includes('/') || value.includes('\\')) return false;
  if (value.includes('\0')) return false;
  return value === path.posix.basename(value);
};

const isMissingSftpError = (error) => /no such file|not found|does not exist/i.test(String(error?.message || ''));

const resolveFileTargetByName = (fileName) => {
  const key = normalizeText(fileName).toLowerCase();
  const special = SPECIAL_LUA_LOGS_BY_NAME.get(key);
  if (special) {
    return {
      name: special.name,
      displayName: special.displayName,
      remotePath: special.remotePath,
      isSpecialLuaLog: true,
    };
  }

  return {
    name: normalizeText(fileName),
    displayName: normalizeText(fileName),
    remotePath: path.posix.join(LOGS_DIR, normalizeText(fileName)),
    isSpecialLuaLog: false,
  };
};

const toSpecialLuaFileEntryFromStat = (target, stat) => {
  const isDirectory = typeof stat?.isDirectory === 'function'
    ? stat.isDirectory()
    : Boolean(stat?.isDirectory);
  if (!stat || isDirectory) {
    return {
      name: target.name,
      displayName: target.displayName,
      sizeBytes: 0,
      modifiedAt: null,
      exists: false,
      isSpecialLuaLog: true,
      missingReason: 'Path is not a file.',
    };
  }

  return {
    name: target.name,
    displayName: target.displayName,
    sizeBytes: Number(stat.size) || 0,
    modifiedAt: toIsoTimestamp(stat.modifyTime ?? stat.mtime ?? stat.modify),
    exists: true,
    isSpecialLuaLog: true,
    missingReason: null,
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

      const sortedRegularFiles = listing
        .filter((entry) => entry?.type === '-')
        .sort((left, right) => (Number(right?.modifyTime) || 0) - (Number(left?.modifyTime) || 0))
        .map(toPublicFileEntry);

      const limitedRegularFiles = listLimit
        ? sortedRegularFiles.slice(0, listLimit)
        : sortedRegularFiles;

      const specialLuaFiles = [];
      for (const special of SPECIAL_LUA_LOG_FILES) {
        try {
          const stat = await sftp.sftp.stat(special.remotePath);
          specialLuaFiles.push(
            toSpecialLuaFileEntryFromStat(
              {
                name: special.name,
                displayName: special.displayName,
                remotePath: special.remotePath,
                isSpecialLuaLog: true,
              },
              stat,
            ),
          );
        } catch (statError) {
          if (isMissingSftpError(statError)) {
            specialLuaFiles.push({
              name: special.name,
              displayName: special.displayName,
              sizeBytes: 0,
              modifiedAt: null,
              exists: false,
              isSpecialLuaLog: true,
              missingReason: 'File is not created yet.',
            });
            continue;
          }
          throw statError;
        }
      }

      const files = [...limitedRegularFiles, ...specialLuaFiles]
        .sort((left, right) => {
          const leftTs = left?.modifiedAt ? new Date(left.modifiedAt).getTime() : 0;
          const rightTs = right?.modifiedAt ? new Date(right.modifiedAt).getTime() : 0;
          return (rightTs || 0) - (leftTs || 0);
        });

      return res.json({
        ok: true,
        logDir: LOGS_DIR,
        count: files.length,
        regularLogCount: limitedRegularFiles.length,
        specialLuaLogCount: specialLuaFiles.length,
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

    const target = resolveFileTargetByName(requestedFileName);
    const remotePath = target.remotePath;
    const sftp = new SftpLogReader();

    try {
      await sftp.connect();
      const stat = await sftp.sftp.stat(remotePath);
      const isDirectory = typeof stat?.isDirectory === 'function'
        ? stat.isDirectory()
        : Boolean(stat?.isDirectory);
      if (!stat || isDirectory) {
        return res.status(404).json({
          error: target.isSpecialLuaLog
            ? `${target.displayName} is not available yet (file not created).`
            : 'Log file not found.',
        });
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

      const statusCode = isMissingSftpError(error) ? 404 : 500;
      logger.error('[server-logs] download file failed', {
        userId: req.authZmUser?.id ?? null,
        fileName: requestedFileName,
        remotePath,
        error: error.message,
        stack: error.stack,
      });
      if (statusCode === 404) {
        return res.status(404).json({
          error: target.isSpecialLuaLog
            ? `${target.displayName} is not available yet (file not created).`
            : 'Log file not found.',
        });
      }
      return res.status(500).json({ error: `Failed to download log file: ${error.message}` });
    } finally {
      await sftp.disconnect();
    }
  },
);

export default router;
