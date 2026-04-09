import fs from 'fs/promises';
import path from 'path';
import cron from 'node-cron';
import logger from '../utils/logger.js';
import { SftpLogReader } from '../utils/sftpLogReader.js';

const DEFAULT_LOCAL_QUEUE_PATH = 'C:\\Users\\Michael\\Zomboid\\Lua\\ZMFleaMarket\\ZMFleaMarket_api_queue.jsonl';
const DEFAULT_REMOTE_QUEUE_PATH = '/home/pzserver/Zomboid/Lua/ZMFleaMarket/ZMFleaMarket_api_queue.jsonl';
const DEFAULT_CRON = '*/1 * * * *';
const DEFAULT_MAX_PER_RUN = 20;
const DEFAULT_TIMEOUT_MS = 30000;

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function isMissingPathError(error) {
  const text = String(error?.message || error || '');
  return /ENOENT|no such file|not exist|cannot find|not found/i.test(text);
}

function nowIso() {
  return new Date().toISOString();
}

function trimText(value) {
  return String(value || '').trim();
}

function preview(value, limit = 200) {
  const text = trimText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated]`;
}

function normalizeMode() {
  const explicit = trimText(process.env.NODEAPI_QUEUE_MODE).toLowerCase();
  if (explicit === 'dev' || explicit === 'development' || explicit === 'local') return 'dev';
  if (explicit === 'live' || explicit === 'production' || explicit === 'prod' || explicit === 'remote') return 'live';

  const fleaMode = trimText(process.env.FLEA_MARKET_CACHE_MODE).toLowerCase();
  if (fleaMode === 'dev' || fleaMode === 'development' || fleaMode === 'local') return 'dev';
  if (fleaMode === 'live' || fleaMode === 'production' || fleaMode === 'prod' || fleaMode === 'remote') return 'live';

  return process.platform === 'win32' ? 'dev' : 'live';
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeBaseUrl(value) {
  const text = trimText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function shouldUseDefaultFleaFallback(entry) {
  const sourceModule = trimText(entry?.sourceModule);
  if (sourceModule !== 'ZMFleaMarket') return false;

  const queueTag = trimText(entry?.queueTag).toLowerCase();
  const targetUrl = trimText(entry?.url).toLowerCase();
  if (targetUrl.includes('/api/flea-market/')) {
    return true;
  }

  return queueTag === 'flea_public_listings_refresh'
    || queueTag === 'flea_market_sync'
    || queueTag === 'flea_sell_listing';
}

function buildAttemptUrls(entry) {
  const originalUrl = trimText(entry?.url);
  if (!originalUrl) return [];

  let parsedOriginal;
  try {
    parsedOriginal = new URL(originalUrl);
  } catch {
    return [originalUrl];
  }

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (url) => {
    const key = trimText(url).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(url);
  };

  pushCandidate(originalUrl);

  const configuredFallbackBases = parseCsvEnv(process.env.NODEAPI_QUEUE_FALLBACK_BASE_URLS)
    .map(normalizeBaseUrl)
    .filter(Boolean);

  let fallbackBases = configuredFallbackBases;
  if (fallbackBases.length === 0 && shouldUseDefaultFleaFallback(entry)) {
    fallbackBases = [
      'http://127.0.0.1:3000',
      'https://api.zonamerah.pro'
    ];
  }

  for (const base of fallbackBases) {
    try {
      const parsedBase = new URL(base);
      const candidate = `${parsedBase.origin}${parsedOriginal.pathname}${parsedOriginal.search}`;
      pushCandidate(candidate);
    } catch {
      // ignore malformed fallback base
    }
  }

  return candidates;
}

function isExecutableNodeApiEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (trimText(entry.type).toLowerCase() !== 'nodeapi') return false;

  const method = trimText(entry.method).toUpperCase();
  if (!method) return false;

  const url = trimText(entry.url).toLowerCase();
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

  return true;
}

export class NodeApiQueueProcessor {
  constructor() {
    this.enabled = parseBoolean(process.env.NODEAPI_QUEUE_ENABLED, true);
    this.mode = normalizeMode();
    this.localQueuePath = trimText(process.env.NODEAPI_QUEUE_LOCAL_PATH) || DEFAULT_LOCAL_QUEUE_PATH;
    this.remoteQueuePath = trimText(process.env.NODEAPI_QUEUE_REMOTE_PATH) || DEFAULT_REMOTE_QUEUE_PATH;
    this.cronExpression = trimText(process.env.NODEAPI_QUEUE_CRON) || DEFAULT_CRON;
    this.maxPerRun = Math.max(1, Number.parseInt(process.env.NODEAPI_QUEUE_MAX_PER_RUN || String(DEFAULT_MAX_PER_RUN), 10) || DEFAULT_MAX_PER_RUN);
    this.requestTimeoutMs = Math.max(1000, Number.parseInt(process.env.NODEAPI_QUEUE_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS);
    this.processing = false;
    this.job = null;
    this.processingId = `${process.pid}_${Date.now()}`;
    this.sftp = new SftpLogReader();
  }

  getQueuePath(mode = this.mode) {
    return mode === 'live' ? this.remoteQueuePath : this.localQueuePath;
  }

  start() {
    if (!this.enabled) {
      console.log('[NodeApiQueue] disabled by NODEAPI_QUEUE_ENABLED=false');
      logger.info('nodeapi queue processor disabled');
      return;
    }

    if (!cron.validate(this.cronExpression)) {
      const bad = this.cronExpression;
      this.cronExpression = DEFAULT_CRON;
      logger.error('nodeapi queue invalid cron expression, using default', { bad, fallback: DEFAULT_CRON });
    }

    if (this.job) return;

    this.job = cron.schedule(
      this.cronExpression,
      () => {
        this.runOnce('cron').catch((error) => {
          logger.error('nodeapi queue run failed', { error: error?.message, stack: error?.stack });
        });
      },
      { timezone: 'Asia/Jakarta' }
    );

    const queuePath = this.getQueuePath(this.mode);
    console.log(`[NodeApiQueue] started mode=${this.mode} cron="${this.cronExpression}" path=${queuePath} maxPerRun=${this.maxPerRun}`);
    logger.info('nodeapi queue processor started', {
      mode: this.mode,
      cron: this.cronExpression,
      queuePath,
      maxPerRun: this.maxPerRun,
      requestTimeoutMs: this.requestTimeoutMs
    });

    setTimeout(() => {
      this.runOnce('startup').catch((error) => {
        logger.error('nodeapi queue startup run failed', { error: error?.message, stack: error?.stack });
      });
    }, 3000);
  }

  stop() {
    if (!this.job) return;
    this.job.stop();
    if (typeof this.job.destroy === 'function') {
      this.job.destroy();
    }
    this.job = null;
    logger.info('nodeapi queue processor stopped');
  }

  async runOnce(trigger = 'manual') {
    if (!this.enabled) return;

    if (this.processing) {
      logger.warn('nodeapi queue run skipped: already running', { trigger });
      return;
    }

    this.processing = true;
    const startedAt = Date.now();
    let sourcePath = '';
    let processingPath = '';
    let mode = this.mode;

    try {
      const claim = await this.claimQueueFile();
      if (!claim) {
        return;
      }

      mode = claim.mode;
      sourcePath = claim.sourcePath;
      processingPath = claim.processingPath;

      const lines = String(claim.content || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        await this.deleteFile(mode, processingPath);
        return;
      }

      let scanned = 0;
      let executed = 0;
      let succeeded = 0;
      let failed = 0;
      let dropped = 0;
      const retryLines = [];

      console.log(`[NodeApiQueue] picked lines=${lines.length} trigger=${trigger} mode=${mode}`);

      for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i];
        scanned += 1;

        if (executed >= this.maxPerRun) {
          retryLines.push(rawLine);
          continue;
        }

        const entry = parseJsonLine(rawLine);
        if (!isExecutableNodeApiEntry(entry)) {
          dropped += 1;
          logger.warn('nodeapi queue drop invalid entry', {
            trigger,
            lineIndex: i + 1,
            preview: preview(rawLine, 220)
          });
          continue;
        }

        executed += 1;
        const result = await this.executeEntry(entry);
        if (result.ok) {
          succeeded += 1;
        } else {
          failed += 1;
          retryLines.push(rawLine);
        }
      }

      if (retryLines.length > 0) {
        await this.appendLines(mode, sourcePath, retryLines);
      }

      await this.deleteFile(mode, processingPath);

      const durationMs = Date.now() - startedAt;
      console.log(
        `[NodeApiQueue] done trigger=${trigger} scanned=${scanned} executed=${executed} ok=${succeeded} failed=${failed} dropped=${dropped} requeued=${retryLines.length} durationMs=${durationMs}`
      );
      logger.info('nodeapi queue run complete', {
        trigger,
        mode,
        sourcePath,
        scanned,
        executed,
        succeeded,
        failed,
        dropped,
        requeued: retryLines.length,
        durationMs
      });
    } catch (error) {
      logger.error('nodeapi queue fatal run error', {
        trigger,
        mode,
        sourcePath,
        processingPath,
        error: error?.message,
        stack: error?.stack
      });
      throw error;
    } finally {
      this.processing = false;
    }
  }

  async executeEntry(entry) {
    const requestId = trimText(entry.requestId) || `queue_${Date.now()}`;
    const method = trimText(entry.method).toUpperCase();
    const url = trimText(entry.url);
    const sourceModule = trimText(entry.sourceModule) || 'unknown';
    const queueTag = trimText(entry.queueTag) || 'nodeapi';

    let bodyText = '';
    if (typeof entry.body === 'string') {
      bodyText = entry.body;
    } else if (entry.body && typeof entry.body === 'object') {
      try {
        bodyText = JSON.stringify(entry.body);
      } catch {
        bodyText = '';
      }
    }

    const attemptUrls = buildAttemptUrls(entry);
    let lastFailure = null;

    for (let attemptIndex = 0; attemptIndex < attemptUrls.length; attemptIndex += 1) {
      const attemptUrl = attemptUrls[attemptIndex];
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('request timeout')), this.requestTimeoutMs);

      try {
        console.log(
          `[NodeApiQueue][EXEC] requestId=${requestId} source=${sourceModule} tag=${queueTag} method=${method} url=${attemptUrl} attempt=${attemptIndex + 1}/${attemptUrls.length}`
        );

        const headers = {
          'user-agent': 'ZonaNyamanBotZ-QueueProcessor/1.0'
        };

        const options = {
          method,
          headers,
          signal: controller.signal
        };

        const canHaveBody = method !== 'GET' && method !== 'HEAD';
        if (canHaveBody && bodyText.trim() !== '') {
          headers['content-type'] = 'application/json';
          options.body = bodyText;
        }

        const response = await fetch(attemptUrl, options);
        const text = await response.text();
        const durationMs = Date.now() - startedAt;
        const status = Number(response.status) || 0;

        if (response.ok) {
          console.log(`[NodeApiQueue][OK] requestId=${requestId} status=${status} durationMs=${durationMs} body=${preview(text, 200)} url=${attemptUrl}`);
          logger.info('nodeapi queue request success', {
            requestId,
            sourceModule,
            queueTag,
            method,
            url: attemptUrl,
            originalUrl: url,
            status,
            durationMs,
            attempt: attemptIndex + 1,
            attempts: attemptUrls.length
          });
          return { ok: true };
        }

        lastFailure = {
          type: 'http',
          status,
          durationMs,
          bodyPreview: preview(text, 220),
          url: attemptUrl,
          attempt: attemptIndex + 1,
          attempts: attemptUrls.length
        };

        console.error(
          `[NodeApiQueue][FAIL] requestId=${requestId} status=${status} durationMs=${durationMs} body=${preview(text, 220)} url=${attemptUrl} attempt=${attemptIndex + 1}/${attemptUrls.length}`
        );

        // For 4xx errors (except 429), retrying another base usually won't help.
        if (status >= 400 && status < 500 && status !== 429) {
          break;
        }
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        lastFailure = {
          type: 'exception',
          durationMs,
          error: error?.message,
          stack: error?.stack,
          url: attemptUrl,
          attempt: attemptIndex + 1,
          attempts: attemptUrls.length
        };
        console.error(
          `[NodeApiQueue][ERROR] requestId=${requestId} durationMs=${durationMs} error=${error?.message || error} url=${attemptUrl} attempt=${attemptIndex + 1}/${attemptUrls.length}`
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    logger.error('nodeapi queue request failed', {
      requestId,
      sourceModule,
      queueTag,
      method,
      originalUrl: url,
      attemptUrls,
      failure: lastFailure
    });
    return { ok: false };
  }

  async claimQueueFile() {
    const mode = this.mode;
    const sourcePath = this.getQueuePath(mode);
    const processingPath = `${sourcePath}.processing.${this.processingId}.${Date.now()}.jsonl`;

    const renamed = await this.renameIfExists(mode, sourcePath, processingPath);
    if (!renamed) {
      return null;
    }

    const content = await this.readFile(mode, processingPath);
    return {
      mode,
      sourcePath,
      processingPath,
      content
    };
  }

  async renameIfExists(mode, fromPath, toPath) {
    if (mode === 'dev') {
      try {
        await fs.mkdir(path.dirname(fromPath), { recursive: true });
        await fs.rename(fromPath, toPath);
        return true;
      } catch (error) {
        if (isMissingPathError(error)) return false;
        throw error;
      }
    }

    return this.sftp.executeWithQueue(async () => {
      try {
        await this.sftp.connect();
        await this.sftp.sftp.rename(fromPath, toPath);
        return true;
      } catch (error) {
        if (isMissingPathError(error)) return false;
        throw error;
      } finally {
        await this.sftp.disconnect();
      }
    });
  }

  async readFile(mode, filePath) {
    if (mode === 'dev') {
      try {
        return await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if (isMissingPathError(error)) return '';
        throw error;
      }
    }

    return this.sftp.executeWithQueue(async () => {
      try {
        await this.sftp.connect();
        const buf = await this.sftp.sftp.get(filePath);
        return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
      } catch (error) {
        if (isMissingPathError(error)) return '';
        throw error;
      } finally {
        await this.sftp.disconnect();
      }
    });
  }

  async appendLines(mode, filePath, lines) {
    if (!Array.isArray(lines) || lines.length === 0) return;
    const payload = `${lines.join('\n')}\n`;

    if (mode === 'dev') {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, payload, 'utf8');
      return;
    }

    await this.sftp.executeWithQueue(async () => {
      try {
        await this.sftp.connect();
        await this.sftp.sftp.append(Buffer.from(payload, 'utf8'), filePath);
      } finally {
        await this.sftp.disconnect();
      }
    });
  }

  async deleteFile(mode, filePath) {
    if (mode === 'dev') {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
      return;
    }

    await this.sftp.executeWithQueue(async () => {
      try {
        await this.sftp.connect();
        await this.sftp.sftp.delete(filePath);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      } finally {
        await this.sftp.disconnect();
      }
    });
  }
}

export default NodeApiQueueProcessor;
