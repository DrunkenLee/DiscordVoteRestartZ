'use strict';

require('dotenv').config();

const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function resolveDatabaseUrl() {
  const dbTarget = String(process.env.DB_TARGET ?? '').trim().toLowerCase();

  if (dbTarget === 'local' || dbTarget === 'prod') {
    return process.env.DATABASE_URL_PROD || process.env.DATABASE_URL || null;
  }

  if (dbTarget === 'remote') {
    return process.env.DATABASE_URL_REMOTE || process.env.DATABASE_URL || null;
  }

  return (
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_PROD ||
    process.env.DATABASE_URL_REMOTE ||
    null
  );
}

function shouldUseSsl() {
  const sslEnv = String(process.env.DB_SSL ?? '').trim().toLowerCase();

  if (sslEnv) {
    return !FALSE_VALUES.has(sslEnv);
  }

  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    return true;
  }

  try {
    const hostname = new URL(databaseUrl).hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return false;
    }
  } catch (error) {
    // If URL parsing fails, keep secure defaults.
  }

  // Default to SSL for remote/VPS Postgres and managed DB providers.
  return true;
}

function buildConnectionOptions() {
  const baseConfig = {
    dialect: 'postgres',
    logging: false
  };

  if (!shouldUseSsl()) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  };
}

function createSequelizeInstance(SequelizeCtor) {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('Missing database URL. Set DATABASE_URL_REMOTE, DATABASE_URL_PROD, or DATABASE_URL.');
  }

  return new SequelizeCtor(databaseUrl, buildConnectionOptions());
}

function buildSequelizeCliConfig() {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('Missing database URL. Set DATABASE_URL_REMOTE, DATABASE_URL_PROD, or DATABASE_URL.');
  }

  const connectionOptions = buildConnectionOptions();

  return {
    development: {
      url: databaseUrl,
      ...connectionOptions
    },
    test: {
      url: databaseUrl,
      ...connectionOptions
    },
    production: {
      url: databaseUrl,
      ...connectionOptions
    }
  };
}

module.exports = {
  resolveDatabaseUrl,
  shouldUseSsl,
  buildConnectionOptions,
  createSequelizeInstance,
  buildSequelizeCliConfig
};
