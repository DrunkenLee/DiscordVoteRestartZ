import fs from 'node:fs';
import path from 'node:path';
import { sequelize } from '../src/models/index.js';
import { FleaMarketListing } from '../src/models/fleaMarketListing.js';

const ALLOWED_STATUS = new Set(['active', 'sold', 'expired', 'redeemed', 'deleted']);

class LuaParser {
  constructor(text) {
    this.text = text || '';
    this.pos = 0;
    this.len = this.text.length;
  }

  parse() {
    this.skipSpace();
    if (this.text.startsWith('return', this.pos)) {
      this.pos += 'return'.length;
    }
    this.skipSpace();
    const value = this.parseValue();
    this.skipSpace();
    return value;
  }

  parseValue() {
    this.skipSpace();
    const ch = this.peekChar();

    if (ch === '{') return this.parseTable();
    if (ch === '"') return this.parseString();
    if (ch === '-' || this.isDigit(ch)) return this.parseNumber();
    if (this.isIdentifierStart(ch)) return this.parseIdentifierValue();

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
  }

  parseTable() {
    this.consumeChar('{');
    const keyed = [];
    const arr = [];
    let hasKeyed = false;
    let hasArray = false;

    while (true) {
      this.skipSpace();
      if (this.peekChar() === '}') {
        this.pos += 1;
        break;
      }

      if (this.peekChar() === '[') {
        hasKeyed = true;
        this.pos += 1;
        const key = this.parseValue();
        this.skipSpace();
        this.consumeChar(']');
        this.skipSpace();
        this.consumeChar('=');
        const value = this.parseValue();
        keyed.push([key, value]);
      } else if (this.isIdentifierStart(this.peekChar())) {
        const identPos = this.pos;
        const ident = this.parseIdentifier();
        this.skipSpace();
        if (this.peekChar() === '=') {
          hasKeyed = true;
          this.pos += 1;
          const value = this.parseValue();
          keyed.push([ident, value]);
        } else {
          // Bare identifier value in array position.
          hasArray = true;
          this.pos = identPos;
          arr.push(this.parseValue());
        }
      } else {
        hasArray = true;
        arr.push(this.parseValue());
      }

      this.skipSpace();
      const next = this.peekChar();
      if (next === ',' || next === ';') {
        this.pos += 1;
      }
    }

    if (hasKeyed && !hasArray) {
      const obj = {};
      for (const [k, v] of keyed) {
        obj[String(k)] = v;
      }
      return obj;
    }

    if (!hasKeyed) {
      return arr;
    }

    const obj = {};
    for (const [k, v] of keyed) {
      obj[String(k)] = v;
    }
    for (let i = 0; i < arr.length; i += 1) {
      obj[String(i + 1)] = arr[i];
    }
    return obj;
  }

  parseString() {
    this.consumeChar('"');
    let out = '';

    while (this.pos < this.len) {
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos += 1;
        return out;
      }
      if (ch === '\\') {
        const next = this.text[this.pos + 1];
        if (next === undefined) {
          throw new Error(`Unterminated escape at position ${this.pos}`);
        }
        if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else if (next === '"') out += '"';
        else if (next === '\\') out += '\\';
        else out += next;
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos += 1;
    }

    throw new Error('Unterminated string literal');
  }

  parseNumber() {
    const rest = this.text.slice(this.pos);
    const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (!match) {
      throw new Error(`Invalid number at position ${this.pos}`);
    }

    this.pos += match[0].length;
    return Number(match[0]);
  }

  parseIdentifierValue() {
    const ident = this.parseIdentifier();
    if (ident === 'true') return true;
    if (ident === 'false') return false;
    if (ident === 'nil') return null;
    return ident;
  }

  parseIdentifier() {
    const start = this.pos;
    while (this.pos < this.len) {
      const ch = this.text[this.pos];
      if (!this.isIdentifierPart(ch)) break;
      this.pos += 1;
    }
    return this.text.slice(start, this.pos);
  }

  consumeChar(ch) {
    this.skipSpace();
    if (this.peekChar() !== ch) {
      throw new Error(`Expected '${ch}' at position ${this.pos}, got '${this.peekChar()}'`);
    }
    this.pos += 1;
  }

  skipSpace() {
    while (this.pos < this.len) {
      const ch = this.text[this.pos];
      if (ch === '-' && this.text[this.pos + 1] === '-') {
        // Lua single-line comment
        this.pos += 2;
        while (this.pos < this.len && this.text[this.pos] !== '\n') this.pos += 1;
        continue;
      }
      if (!/\s/.test(ch)) break;
      this.pos += 1;
    }
  }

  peekChar() {
    return this.text[this.pos];
  }

  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  isIdentifierStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  isIdentifierPart(ch) {
    return this.isIdentifierStart(ch) || this.isDigit(ch);
  }
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeStatus(status) {
  const text = String(status || '').trim().toLowerCase();
  if (!text) return 'active';
  return ALLOWED_STATUS.has(text) ? text : 'active';
}

function loadLegacyListings(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parser = new LuaParser(raw);
  const parsed = parser.parse();

  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const listings = root.listings && typeof root.listings === 'object' ? root.listings : {};

  return Object.values(listings).filter((x) => x && typeof x === 'object');
}

function mapListing(rawListing) {
  const id = toIntOrNull(rawListing.id);
  const seller = rawListing.seller != null ? String(rawListing.seller).trim() : '';
  const itemType = rawListing.itemType != null ? String(rawListing.itemType).trim() : '';

  if (!id || !seller || !itemType) {
    return null;
  }

  const qty = toIntOrNull(rawListing.qty) ?? 0;
  const price = toIntOrNull(rawListing.price) ?? 0;

  return {
    id,
    seller,
    buyer: rawListing.buyer != null ? String(rawListing.buyer) : null,
    itemType,
    displayName: rawListing.displayName != null ? String(rawListing.displayName) : null,
    qty,
    price,
    total: toIntOrNull(rawListing.total) ?? qty * price,
    createdAtUnix: toIntOrNull(rawListing.createdAt),
    expiresAtUnix: toIntOrNull(rawListing.expiresAt),
    soldAtUnix: toIntOrNull(rawListing.soldAt),
    expiredAtUnix: toIntOrNull(rawListing.expiredAt),
    redeemedAtUnix: toIntOrNull(rawListing.redeemedAt),
    status: normalizeStatus(rawListing.status),
    transactionFee: toIntOrNull(rawListing.transactionFee) ?? 0,
    listingFee: toIntOrNull(rawListing.listingFee) ?? 0,
    lastBuyer: rawListing.lastBuyer != null ? String(rawListing.lastBuyer) : null,
    lastBuyAtUnix: toIntOrNull(rawListing.lastBuyAt),
    adminCancelled: rawListing.adminCancelled === true,
    adminCancelledBy: rawListing.adminCancelledBy != null ? String(rawListing.adminCancelledBy) : null,
    itemData: rawListing.itemData ?? null,
    itemMeta: rawListing.itemMeta ?? null,
    scriptStats: rawListing.scriptStats ?? null
  };
}

async function seedListings(legacyPath) {
  const sourcePath = path.resolve(legacyPath);
  const rows = loadLegacyListings(sourcePath);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  await sequelize.transaction(async (transaction) => {
    for (const row of rows) {
      const payload = mapListing(row);
      if (!payload) {
        skipped += 1;
        continue;
      }

      const existing = await FleaMarketListing.findByPk(payload.id, { transaction });
      if (existing) {
        await existing.update(payload, { transaction });
        updated += 1;
      } else {
        await FleaMarketListing.create(payload, { transaction });
        created += 1;
      }
    }
  });

  return {
    sourcePath,
    sourceCount: rows.length,
    created,
    updated,
    skipped
  };
}

async function main() {
  const argPath = process.argv[2];
  if (!argPath) {
    console.error('Usage: node scripts/seedFleaMarketListingsFromLua.js "<path-to-ZMFleaMarket_listings.lua>"');
    process.exit(1);
  }

  const summary = await seedListings(argPath);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await sequelize.close();
    } catch {
      // no-op
    }
  });

