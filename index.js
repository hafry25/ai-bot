require('dotenv').config();
const ccxt = require('ccxt');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

// ------------------------------
//  Configuration Manager
// ------------------------------
class Config {
  static get(key, fallback) {
    const value = process.env[key];
    return value === undefined || value === '' ? fallback : value;
  }

  static number(key, fallback) {
    const parsed = Number(Config.get(key, fallback));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  static boolean(key, fallback = true) {
    const value = process.env[key];
    if (value === undefined || value === '') return fallback;
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    throw new Error(`${key} must be a boolean value`);
  }

  static isTrue(key) {
    return Config.boolean(key, false);
  }

  static list(key, fallback) {
    return String(Config.get(key, fallback))
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
}

// ------------------------------
//  Constants
// ------------------------------
const SYMBOLS = Config.list('SYMBOLS', 'BTC/USDT');
const EXCHANGE_MODE = (() => {
  const mode = Config.get('EXCHANGE_MODE', Config.boolean('EXCHANGE_DEMO', false) ? 'testnet' : 'live').toLowerCase();
  if (mode === 'demo') return 'testnet';
  return mode;
})();
const VALID_EXCHANGE_MODES = new Set(['live', 'testnet']);
const VALID_GRID_MODES = new Set(['ARITHMETIC', 'GEOMETRIC']);
const MINUTE_MS = 60 * 1000;
const INTERVAL_MINUTES = Config.number('INTERVAL_MINUTES', 1);
const INTERVAL_MS = INTERVAL_MINUTES * MINUTE_MS;

const GRID_COUNT = Config.number('GRID_COUNT', 10);
const GRID_MODE = Config.get('GRID_MODE', 'ARITHMETIC').toUpperCase();
const GRID_LOWER_PRICE = Config.number('GRID_LOWER_PRICE', 0);
const GRID_UPPER_PRICE = Config.number('GRID_UPPER_PRICE', 0);
const GRID_RANGE_PCT = Config.number('GRID_RANGE_PCT', 5);
const GRID_RESET_RANGE_ON_START = Config.boolean('GRID_RESET_RANGE_ON_START', false);
const GRID_TRAILING_RANGE_ENABLED = Config.boolean('GRID_TRAILING_RANGE_ENABLED', false);
const GRID_TRAILING_UP_ENABLED = Config.boolean('GRID_TRAILING_UP_ENABLED', GRID_TRAILING_RANGE_ENABLED);
const GRID_TRAILING_UP_COOLDOWN_MS = Math.max(Config.number('GRID_TRAILING_UP_COOLDOWN_MINUTES', 0), 0) * MINUTE_MS;
const GRID_TRAILING_DOWN_ENABLED = Config.boolean('GRID_TRAILING_DOWN_ENABLED', GRID_TRAILING_RANGE_ENABLED);
const GRID_TRAILING_DOWN_COOLDOWN_MS = Math.max(
  Config.number('GRID_TRAILING_DOWN_COOLDOWN_MINUTES', Config.number('GRID_TRAILING_UP_COOLDOWN_MINUTES', 0)),
  0
) * MINUTE_MS;
const GRID_ORDER_SIZE_USDT = Config.number('GRID_ORDER_SIZE_USDT', Config.number('ORDER_SIZE_USDT', 20));
const GRID_TOTAL_INVESTMENT_USDT = Config.number('GRID_TOTAL_INVESTMENT_USDT', 0);
const GRID_MAX_ACTIVE_BUY_ORDERS = Config.number('GRID_MAX_ACTIVE_BUY_ORDERS', 5);
const GRID_MAX_ACTIVE_SELL_ORDERS = Config.number('GRID_MAX_ACTIVE_SELL_ORDERS', 5);
const GRID_RECREATE_ON_START = Config.boolean('GRID_RECREATE_ON_START', false);
const GRID_CANCEL_OUT_OF_RANGE = Config.boolean('GRID_CANCEL_OUT_OF_RANGE', true);
const GRID_CANCEL_OUT_OF_RANGE_THRESHOLD_MS = Math.max(
  Config.number('GRID_CANCEL_OUT_OF_RANGE_THRESHOLD_MINUTES', Math.max(INTERVAL_MINUTES * 3, 2)),
  0
) * MINUTE_MS;
const GRID_REFILL_ON_FILLED = Config.boolean('GRID_REFILL_ON_FILLED', true);
const GRID_STATE_FILE = Config.get('GRID_STATE_FILE', 'grid-state-spot.json');
const GRID_STATE_PATH = path.resolve(process.cwd(), GRID_STATE_FILE);
const BOT_LOCK_FILE = Config.get('BOT_LOCK_FILE', `${GRID_STATE_FILE}.lock`);
const BOT_LOCK_PATH = path.resolve(process.cwd(), BOT_LOCK_FILE);
const BOT_LOCK_STALE_GRACE_MS = Math.max(Config.number('BOT_LOCK_STALE_GRACE_MS', 2000), 0);
const GRID_POST_ONLY = Config.boolean('GRID_POST_ONLY', true);
const GRID_PRICE_PRECISION_MAX_DEVIATION_PCT = Config.number('GRID_PRICE_PRECISION_MAX_DEVIATION_PCT', 0.05);

const AI_VALIDATION_ENABLED = Config.boolean('AI_VALIDATION_ENABLED', false);
const AI_VALIDATION_TIMEFRAME = Config.get('AI_VALIDATION_TIMEFRAME', '15m');
const AI_VALIDATION_LOOKBACK = Config.number('AI_VALIDATION_LOOKBACK', 80);
const AI_VALIDATION_CACHE_TTL_MS = Config.number('AI_VALIDATION_CACHE_TTL_MS', Math.max(INTERVAL_MS * 3, MINUTE_MS));
const AI_VALIDATION_MIN_INTERVAL_MS = Config.number('AI_VALIDATION_MIN_INTERVAL_MS', MINUTE_MS);
const AI_VALIDATION_BACKOFF_MS = Config.number('AI_VALIDATION_BACKOFF_MS', 10 * MINUTE_MS);
const AI_VALIDATION_PRICE_BUCKET_PCT = Config.number('AI_VALIDATION_PRICE_BUCKET_PCT', 0.25);
const AI_VALIDATION_RETRIES = Config.number('AI_VALIDATION_RETRIES', 2);
const AI_VALIDATION_TIMEOUT_MS = Math.max(Config.number('AI_VALIDATION_TIMEOUT_MS', 30_000), 1000);
const AI_MIN_CONFIDENCE = Config.number('AI_MIN_CONFIDENCE', 70);
const GEMINI_MODEL = Config.get('GEMINI_MODEL', 'gemini-2.0-flash-lite');

const STOP_LOSS_PRICE = Config.number('GRID_STOP_LOSS_PRICE', 0);
const TAKE_PROFIT_PRICE = Config.number('GRID_TAKE_PROFIT_PRICE', 0);
const KILL_SWITCH_ENABLED = Config.boolean('KILL_SWITCH_ENABLED', false);
const STOP_TRADING = Config.isTrue('STOP_TRADING');
const KILL_SWITCH_FILE = Config.get('KILL_SWITCH_FILE', 'bot-paused.flag');
const KILL_SWITCH_PATH = path.resolve(process.cwd(), KILL_SWITCH_FILE);

const FONNTE_ENABLED = Config.boolean('FONNTE_ENABLED', false);
const FONNTE_TOKEN = Config.get('FONNTE_TOKEN', '');
const FONNTE_TARGET = Config.get('FONNTE_TARGET', '');
const FONNTE_API_URL = Config.get('FONNTE_API_URL', 'https://api.fonnte.com/send');
const FONNTE_COUNTRY_CODE = Config.get('FONNTE_COUNTRY_CODE', '62');
const FONNTE_TIMEOUT_MS = Config.number('FONNTE_TIMEOUT_MS', 10_000);

// ---- Learning Memory Configuration ----
const LEARNING_MEMORY_ENABLED = Config.boolean('LEARNING_MEMORY_ENABLED', false);
const LEARNING_MEMORY_FILE = Config.get('LEARNING_MEMORY_FILE', 'learning-memory.json');
const LEARNING_MEMORY_PATH = path.resolve(process.cwd(), LEARNING_MEMORY_FILE);
const LEARNING_MEMORY_LOOKBACK = Config.number('LEARNING_MEMORY_LOOKBACK', 20);
const LEARNING_MEMORY_MIN_SAMPLES = Config.number('LEARNING_MEMORY_MIN_SAMPLES', 5);
const LEARNING_MEMORY_OUTCOME_DELAY_MS = Config.number('LEARNING_MEMORY_OUTCOME_DELAY_MS', 10 * MINUTE_MS);
const LEARNING_MEMORY_RECENCY_HALF_LIFE_MS = Math.max(
  Config.number('LEARNING_MEMORY_RECENCY_HALF_LIFE_HOURS', 24),
  1
) * 60 * 60 * 1000;
const LEARNING_MEMORY_MAX_RECORDS = Config.number('LEARNING_MEMORY_MAX_RECORDS', 2000);
const LEARNING_MEMORY_PROFIT_THRESHOLD_PCT = Config.number('LEARNING_MEMORY_PROFIT_THRESHOLD_PCT', 0.5);
// ---------------------------------------

const MAX_PROCESSED_TRADE_IDS = 2000;
const TRADE_FETCH_LIMIT = 100;
const CIRCUIT_BREAKER_MAX_ERRORS = 5;
const CIRCUIT_BREAKER_PAUSE_MS = 15 * MINUTE_MS;

class AtomicFileWriter {
  static queues = new Map();
  static counter = 0;

  static write(filePath, buildContents) {
    const previous = AtomicFileWriter.queues.get(filePath) || Promise.resolve();
    const sequence = ++AtomicFileWriter.counter;
    const current = previous
      .catch(() => {})
      .then(async () => {
        const tempPath = `${filePath}.${process.pid}.${sequence}.tmp`;
        await fs.promises.writeFile(tempPath, buildContents());
        await fs.promises.rename(tempPath, filePath);
      })
      .catch(err => {
        console.warn(`[FILE] Failed to persist ${filePath}:`, err.message);
      })
      .finally(() => {
        if (AtomicFileWriter.queues.get(filePath) === current) {
          AtomicFileWriter.queues.delete(filePath);
        }
      });
    AtomicFileWriter.queues.set(filePath, current);
    return current;
  }
}

// ------------------------------
//  Utility Functions
// ------------------------------
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function sleepSync(ms) {
  if (!(ms > 0)) return;
  // Used only during startup lock acquisition, before the bot begins its async work.
  try {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {}
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    if (timeoutId.unref) timeoutId.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function retry(fn, retries = 3, delay = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(delay * attempt);
    }
  }
}

function killSwitchActive() {
  if (STOP_TRADING) return true;
  if (!KILL_SWITCH_ENABLED) return false;
  try {
    return fs.existsSync(KILL_SWITCH_PATH);
  } catch {
    return false;
  }
}

function roundNumber(value, digits = 8) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(digits)) : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberOrZero(value) {
  return Number(value) || 0;
}

function hasManualGridRange() {
  return GRID_LOWER_PRICE > 0 && GRID_UPPER_PRICE > 0;
}

function scopedTradeId(symbol, id) {
  return `${symbol}|${id}`;
}

function validateRuntimeConfiguration() {
  const errors = [];
  const requirePositive = (name, value) => {
    if (!(value > 0)) errors.push(`${name} must be greater than 0`);
  };
  const requireNonNegative = (name, value) => {
    if (!(value >= 0)) errors.push(`${name} must be 0 or greater`);
  };
  const requireInteger = (name, value, minimum = 0) => {
    if (!Number.isInteger(value) || value < minimum) {
      errors.push(`${name} must be an integer of at least ${minimum}`);
    }
  };

  if (!SYMBOLS.length) errors.push('SYMBOLS must contain at least one symbol');
  if (!VALID_EXCHANGE_MODES.has(EXCHANGE_MODE)) {
    errors.push(`EXCHANGE_MODE must be one of: ${[...VALID_EXCHANGE_MODES].join(', ')}`);
  }
  if (!VALID_GRID_MODES.has(GRID_MODE)) {
    errors.push('GRID_MODE must be ARITHMETIC or GEOMETRIC');
  }

  requirePositive('INTERVAL_MINUTES', INTERVAL_MINUTES);
  requireInteger('GRID_COUNT', GRID_COUNT, 2);
  requireNonNegative('GRID_TOTAL_INVESTMENT_USDT', GRID_TOTAL_INVESTMENT_USDT);
  requirePositive(
    GRID_TOTAL_INVESTMENT_USDT > 0 ? 'GRID_TOTAL_INVESTMENT_USDT' : 'GRID_ORDER_SIZE_USDT',
    GRID_TOTAL_INVESTMENT_USDT > 0 ? GRID_TOTAL_INVESTMENT_USDT : GRID_ORDER_SIZE_USDT
  );
  requireInteger('GRID_MAX_ACTIVE_BUY_ORDERS', GRID_MAX_ACTIVE_BUY_ORDERS);
  requireInteger('GRID_MAX_ACTIVE_SELL_ORDERS', GRID_MAX_ACTIVE_SELL_ORDERS);
  requireInteger('AI_VALIDATION_RETRIES', AI_VALIDATION_RETRIES);
  requireNonNegative('BOT_LOCK_STALE_GRACE_MS', BOT_LOCK_STALE_GRACE_MS);
  requirePositive('AI_VALIDATION_TIMEOUT_MS', AI_VALIDATION_TIMEOUT_MS);
  requirePositive('FONNTE_TIMEOUT_MS', FONNTE_TIMEOUT_MS);

  const hasLower = GRID_LOWER_PRICE > 0;
  const hasUpper = GRID_UPPER_PRICE > 0;
  if (!hasLower && !hasUpper) requirePositive('GRID_RANGE_PCT', GRID_RANGE_PCT);
  if (hasLower !== hasUpper) {
    errors.push('GRID_LOWER_PRICE and GRID_UPPER_PRICE must both be set or both be 0');
  } else if (hasLower && GRID_LOWER_PRICE >= GRID_UPPER_PRICE) {
    errors.push('GRID_LOWER_PRICE must be lower than GRID_UPPER_PRICE');
  }

  if (!process.env.EXCHANGE_API_KEY || !process.env.EXCHANGE_SECRET) {
    errors.push('EXCHANGE_API_KEY and EXCHANGE_SECRET are required');
  }
  if (AI_VALIDATION_ENABLED && !process.env.GEMINI_API_KEY) {
    errors.push('GEMINI_API_KEY is required when AI_VALIDATION_ENABLED=true');
  }
  if (FONNTE_ENABLED && (!FONNTE_TOKEN || !FONNTE_TARGET)) {
    errors.push('FONNTE_TOKEN and FONNTE_TARGET are required when FONNTE_ENABLED=true');
  }

  if (
    GRID_TOTAL_INVESTMENT_USDT > 0 &&
    GRID_ORDER_SIZE_USDT > 0 &&
    GRID_TOTAL_INVESTMENT_USDT / Math.max(GRID_COUNT, 1) < GRID_ORDER_SIZE_USDT
  ) {
    console.warn(
      `[CONFIG] GRID_TOTAL_INVESTMENT_USDT takes precedence; effective per-grid order size is ` +
      `${roundNumber(GRID_TOTAL_INVESTMENT_USDT / Math.max(GRID_COUNT, 1), 8)} USDT, below GRID_ORDER_SIZE_USDT=${GRID_ORDER_SIZE_USDT}`
    );
  }

  if (errors.length) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }
}

// ------------------------------
//  Single Process Lock
// ------------------------------
class ProcessLock {
  constructor(lockPath) {
    this.lockPath = lockPath;
    this.fd = null;
    this.ownerToken = null;
  }

  processIsAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM';
    }
  }

  readOwner() {
    const raw = fs.readFileSync(this.lockPath, 'utf8').trim();
    if (!raw) {
      return { pid: null, token: null, malformed: true };
    }
    try {
      const parsed = JSON.parse(raw);
      const pid = Number(parsed.pid);
      if (!Number.isInteger(pid) || pid <= 0) {
        return { pid: null, token: null, malformed: true };
      }
      return {
        pid,
        token: typeof parsed.token === 'string' ? parsed.token : null,
      };
    } catch {
      const pid = Number(raw);
      if (Number.isInteger(pid) && pid > 0) {
        return { pid, token: null };
      }
      return { pid: null, token: null, malformed: true };
    }
  }

  removeMalformedLock(owner) {
    if (!owner?.malformed) return false;
    if (owner.pid && this.processIsAlive(owner.pid)) return false;
    try {
      fs.unlinkSync(this.lockPath);
      console.warn(`[LOCK] Removed malformed stale lock ${this.lockPath}`);
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return true;
    }
  }

  removeStaleLock(owner) {
    if (!owner || owner.malformed || this.processIsAlive(owner.pid)) return false;
    console.warn(
      `[LOCK] Found stale lock for PID ${owner.pid}; waiting ${BOT_LOCK_STALE_GRACE_MS}ms before cleanup`
    );
    sleepSync(BOT_LOCK_STALE_GRACE_MS);

    let latest;
    try {
      latest = this.readOwner();
    } catch (err) {
      if (err.code === 'ENOENT') return true;
      throw err;
    }

    const sameOwner = latest.pid === owner.pid && latest.token === owner.token;
    if (!sameOwner || this.processIsAlive(latest.pid)) return false;

    try {
      fs.unlinkSync(this.lockPath);
      console.warn(`[LOCK] Removed stale lock ${this.lockPath} for dead PID ${owner.pid}`);
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return true;
    }
  }

  ownsLock() {
    if (!this.ownerToken) return false;
    try {
      const owner = this.readOwner();
      return owner.pid === process.pid && owner.token === this.ownerToken;
    } catch {
      return false;
    }
  }

  // Returns true if the lock does not exist, false if a valid lock exists.
  assertLockCanBeAcquired() {
    try {
      const owner = this.readOwner();
      if (this.removeMalformedLock(owner)) return true;
      if (this.removeStaleLock(owner)) return true;
      if (!this.processIsAlive(owner.pid)) return false;
      return false;
    } catch (err) {
      if (err.code === 'ENOENT') return true;
      throw err;
    }
  }

  acquire() {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        this.fd = fs.openSync(this.lockPath, 'wx');
        this.ownerToken = crypto.randomUUID();
        fs.writeSync(this.fd, JSON.stringify({
          pid: process.pid,
          token: this.ownerToken,
          acquiredAt: new Date().toISOString(),
        }));
        fs.fsyncSync(this.fd);
        if (!this.ownsLock()) {
          fs.closeSync(this.fd);
          this.fd = null;
          this.ownerToken = null;
          throw new Error(`Lost bot lock during acquisition: ${this.lockPath}`);
        }
        console.log(`[LOCK] Acquired lock ${this.lockPath} for PID ${process.pid}`);
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        let owner;
        try {
          owner = this.readOwner();
        } catch (readErr) {
          if (readErr.code === 'ENOENT') continue;
          throw readErr;
        }
        if (this.removeMalformedLock(owner)) continue;
        if (this.processIsAlive(owner.pid)) {
          throw new Error(`Bot already running with PID ${owner.pid}. Lock: ${this.lockPath}`);
        }
        if (this.removeStaleLock(owner)) continue;
      }
    }
    throw new Error(`Unable to acquire bot lock after repeated stale-lock cleanup: ${this.lockPath}`);
  }

  release() {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
      if (this.ownsLock()) {
        fs.unlinkSync(this.lockPath);
        console.log(`[LOCK] Released lock ${this.lockPath}`);
      } else {
        console.warn('[LOCK] Not releasing a lock with a different ownership token');
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[LOCK] Failed to release:', err.message);
    } finally {
      this.fd = null;
      this.ownerToken = null;
    }
  }
}

// ------------------------------
//  Exchange Singleton
// ------------------------------
class ExchangeManager {
  static instance = null;

  static getInstance() {
    if (!this.instance) {
      if (!VALID_EXCHANGE_MODES.has(EXCHANGE_MODE)) {
        throw new Error(`EXCHANGE_MODE invalid: ${EXCHANGE_MODE}. Use live or testnet.`);
      }
      this.instance = new ccxt.binance({
        apiKey: process.env.EXCHANGE_API_KEY,
        secret: process.env.EXCHANGE_SECRET,
        enableRateLimit: true,
        options: {
          defaultType: 'spot',
          fetchMarkets: { types: ['spot'] },
          adjustForTimeDifference: true,
          recvWindow: 10000,
        },
      });
      if (EXCHANGE_MODE === 'testnet') {
        this.instance.setSandboxMode(true);
      }
    }
    return this.instance;
  }
}

// ------------------------------
//  Persistent Grid State
// ------------------------------
class GridState {
  constructor() {
    this.data = this.load();
    this.rebuildProcessedTradeIndex();
  }

  static createEmpty() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      symbols: {},
      processedTradeIds: [],
      totals: { filledBuys: 0, filledSells: 0, realizedGridProfit: 0 },
    };
  }

  static normalize(data) {
    const normalized = isPlainObject(data) ? data : {};
    normalized.version = numberOrZero(normalized.version) || 1;
    normalized.updatedAt = normalized.updatedAt || new Date().toISOString();
    normalized.symbols = isPlainObject(normalized.symbols) ? normalized.symbols : {};
    normalized.processedTradeIds = Array.isArray(normalized.processedTradeIds)
      ? normalized.processedTradeIds.map(String).slice(-MAX_PROCESSED_TRADE_IDS)
      : [];
    normalized.totals = isPlainObject(normalized.totals) ? normalized.totals : {};
    normalized.totals.filledBuys = numberOrZero(normalized.totals.filledBuys);
    normalized.totals.filledSells = numberOrZero(normalized.totals.filledSells);
    normalized.totals.realizedGridProfit = numberOrZero(normalized.totals.realizedGridProfit);
    return normalized;
  }

  load() {
    try {
      if (fs.existsSync(GRID_STATE_PATH)) {
        return GridState.normalize(JSON.parse(fs.readFileSync(GRID_STATE_PATH, 'utf8')));
      }
    } catch (err) {
      console.warn('[STATE] Failed to read grid state, starting fresh:', err.message);
    }
    return GridState.createEmpty();
  }

  rebuildProcessedTradeIndex() {
    this.processedTradeIdSet = new Set(this.data.processedTradeIds);
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    AtomicFileWriter.write(GRID_STATE_PATH, () => JSON.stringify(this.data, null, 2));
  }

  getSymbol(symbol) {
    const existing = this.data.symbols[symbol];
    if (!isPlainObject(existing)) {
      this.data.symbols[symbol] = {
        createdAt: new Date().toISOString(),
        config: {},
        orders: {},
        lastBuyByLevel: {},
        realizedGridProfit: 0,
        lastTradeTimestamp: 0,
        trailingUp: { shifts: 0, lastShiftAt: null },
        trailingDown: { shifts: 0, lastShiftAt: null },
      };
    }
    const sym = this.data.symbols[symbol];
    sym.config = isPlainObject(sym.config) ? sym.config : {};
    sym.orders = isPlainObject(sym.orders) ? sym.orders : {};
    sym.lastBuyByLevel = isPlainObject(sym.lastBuyByLevel) ? sym.lastBuyByLevel : {};
    sym.realizedGridProfit = numberOrZero(sym.realizedGridProfit);
    sym.lastTradeTimestamp = numberOrZero(sym.lastTradeTimestamp);
    if (!sym.trailingUp) sym.trailingUp = { shifts: 0, lastShiftAt: null };
    if (!sym.trailingDown) sym.trailingDown = { shifts: 0, lastShiftAt: null };
    return sym;
  }

  rememberOrder(symbol, order, meta) {
    const sym = this.getSymbol(symbol);
    sym.orders[String(order.id)] = {
      id: String(order.id),
      side: order.side,
      levelIndex: meta.levelIndex,
      price: Number(order.price),
      amount: Number(order.amount),
      createdAt: new Date().toISOString(),
    };
    this.save();
  }

  forgetOrder(symbol, orderId) {
    const sym = this.getSymbol(symbol);
    delete sym.orders[String(orderId)];
    this.save();
  }

  processedTrade(symbol, id) {
    const scopedId = scopedTradeId(symbol, id);
    const legacyId = String(id);
    return this.processedTradeIdSet.has(scopedId) ||
      this.processedTradeIdSet.has(legacyId);
  }

  markProcessedTrade(symbol, id) {
    const scopedId = scopedTradeId(symbol, id);
    if (this.processedTrade(symbol, id)) return false;
    this.data.processedTradeIds.push(scopedId);
    this.processedTradeIdSet.add(scopedId);
    this.data.processedTradeIds = this.data.processedTradeIds.slice(-MAX_PROCESSED_TRADE_IDS);
    if (this.data.processedTradeIds.length >= MAX_PROCESSED_TRADE_IDS) {
      this.rebuildProcessedTradeIndex();
    }
    this.save();
    return true;
  }
}

// ------------------------------
//  Learning Memory
// ------------------------------
class LearningMemory {
  constructor() {
    this.records = [];
    this.filePath = LEARNING_MEMORY_PATH;
    this.enabled = LEARNING_MEMORY_ENABLED;
    if (LEARNING_MEMORY_ENABLED) {
      this.load();
    }
  }

  isEnabled() {
    return this.enabled !== false;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.records = Array.isArray(parsed)
          ? parsed.map(record => this.normalizeRecord(record)).filter(Boolean)
          : [];
        console.log(`[MEMORY] Loaded ${this.records.length} decision records.`);
      }
    } catch (err) {
      console.warn('[MEMORY] Failed to load memory file, starting fresh:', err.message);
      this.records = [];
    }
  }

  save() {
    if (!this.isEnabled()) return;
    AtomicFileWriter.write(this.filePath, () => `${JSON.stringify(this.records, null, 2)}\n`);
  }

  normalizeRecord(record) {
    if (!isPlainObject(record)) return null;
    const context = isPlainObject(record.context) ? this.extractFeatures(record.context) : null;
    if (!context) return null;
    return {
      id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
      symbol: typeof record.symbol === 'string' ? record.symbol : 'unknown',
      timestamp: Number(record.timestamp) || Date.now(),
      context,
      decision: isPlainObject(record.decision)
        ? {
            allowTrading: record.decision.allowTrading === true,
            allowBuy: record.decision.allowBuy === true,
            allowSell: record.decision.allowSell === true,
            confidence: Number(record.decision.confidence) || 0,
            reason: String(record.decision.reason || ''),
          }
        : {
            allowTrading: false,
            allowBuy: false,
            allowSell: false,
            confidence: 0,
            reason: '',
          },
      profitAtDecision: Number.isFinite(Number(record.profitAtDecision)) ? Number(record.profitAtDecision) : null,
      outcome: record.outcome === 'success' || record.outcome === 'failure' ? record.outcome : null,
      outcomeAt: Number(record.outcomeAt) || null,
      outcomeDelta: Number.isFinite(Number(record.outcomeDelta)) ? Number(record.outcomeDelta) : null,
    };
  }

  recordDecision(symbol, context, decision, profit = null, features = null) {
    if (!this.isEnabled()) return;
    const record = {
      id: crypto.randomUUID(),
      symbol,
      timestamp: Date.now(),
      context: this.recordFeatures(context, features),
      decision: {
        allowTrading: decision.allowTrading,
        allowBuy: decision.allowBuy,
        allowSell: decision.allowSell,
        confidence: decision.confidence,
        reason: decision.reason,
      },
      profitAtDecision: profit,
      outcome: null,
    };
    this.records.push(record);
    if (this.records.length > LEARNING_MEMORY_MAX_RECORDS) {
      this.records = this.records.slice(-LEARNING_MEMORY_MAX_RECORDS);
    }
    this.save();
  }

  recordFeatures(context, features = null) {
    const extracted = this.extractFeatures(context);
    if (!isPlainObject(features)) return extracted;
    for (const key of Object.keys(extracted)) {
      if (Number.isFinite(Number(features[key]))) {
        extracted[key] = Number(features[key]);
      }
    }
    return extracted;
  }

  extractFeatures(context) {
    const {
      currentPrice, lower, upper,
      trailingUpJustShifted, trailingDownJustShifted
    } = context;
    const price = Number(currentPrice) || 0;
    const lowerPrice = Number(lower) || 0;
    const upperPrice = Number(upper) || 0;
    const span = Math.max(upperPrice - lowerPrice, 0);
    const mid = (lowerPrice + upperPrice) / 2;
    const rangePct = mid > 0 ? (span / mid) * 100 : 0;
    const distLower = price > 0 ? ((price - lowerPrice) / price) * 100 : 0;
    const distUpper = price > 0 ? ((upperPrice - price) / price) * 100 : 0;
    const positionPct = span > 0 ? ((price - lowerPrice) / span) * 100 : 50;
    return {
      currentPrice: price,
      rangePct: rangePct || 0,
      distLower: distLower || 0,
      distUpper: distUpper || 0,
      positionPct: positionPct || 0,
      trailingUp: trailingUpJustShifted ? 1 : 0,
      trailingDown: trailingDownJustShifted ? 1 : 0,
      changePct: 0,
      volumeRatio: 0,
    };
  }

  enrichContextFeatures(features, candleSummary) {
    features.changePct = candleSummary.changePct || 0;
    features.volumeRatio = candleSummary.volumeRatio || 0;
    return features;
  }

  similarity(f1, f2) {
    return this.similarityWithScales(f1, f2, this.defaultSimilarityScales());
  }

  defaultSimilarityScales() {
    return [
      { key: 'rangePct', min: 0, max: 20 },
      { key: 'distLower', min: -20, max: 20 },
      { key: 'distUpper', min: -20, max: 20 },
      { key: 'positionPct', min: 0, max: 100 },
      { key: 'changePct', min: -20, max: 20 },
      { key: 'volumeRatio', min: 0, max: 10 },
      { key: 'trailingUp', min: 0, max: 1 },
      { key: 'trailingDown', min: 0, max: 1 },
    ];
  }

  buildSimilarityScales(features, candidates) {
    return this.defaultSimilarityScales().map(scale => {
      const values = [features?.[scale.key], ...candidates.map(r => r.context?.[scale.key])]
        .map(Number)
        .filter(Number.isFinite);
      if (values.length < 2) return scale;
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (max - min <= Number.EPSILON) return scale;
      return { ...scale, min, max };
    });
  }

  similarityWithScales(f1, f2, scales) {
    let sumSq = 0;
    for (const f of scales) {
      const denom = f.max - f.min;
      const a = Number(f1?.[f.key]) || 0;
      const b = Number(f2?.[f.key]) || 0;
      const na = denom > 0 ? (a - f.min) / denom : 0;
      const nb = denom > 0 ? (b - f.min) / denom : 0;
      sumSq += (na - nb) ** 2;
    }
    return Math.sqrt(sumSq / scales.length);
  }

  similarityWeight(distance) {
    return 1 / (1 + Math.max(distance, 0));
  }

  recencyWeight(timestamp) {
    const ageMs = Math.max(Date.now() - Number(timestamp || 0), 0);
    return Math.pow(0.5, ageMs / LEARNING_MEMORY_RECENCY_HALF_LIFE_MS);
  }

  querySimilarWithFeatures(features) {
    if (!this.isEnabled()) return null;
    const now = Date.now();
    const candidates = this.records.filter(r =>
      r.symbol === features.symbol &&
      r.outcome !== null &&
      (now - r.timestamp) > LEARNING_MEMORY_OUTCOME_DELAY_MS
    );
    if (candidates.length < LEARNING_MEMORY_MIN_SAMPLES) return null;

    const scales = this.buildSimilarityScales(features, candidates);
    const scored = candidates.map(r => {
      const dist = this.similarityWithScales(features, r.context, scales);
      const similarityWeight = this.similarityWeight(dist);
      const recencyWeight = this.recencyWeight(r.timestamp);
      return {
        ...r,
        dist,
        similarityWeight,
        recencyWeight,
        weight: similarityWeight * recencyWeight,
      };
    });
    scored.sort((a, b) => a.dist - b.dist);
    const top = scored.slice(0, LEARNING_MEMORY_LOOKBACK);
    const weighted = top.reduce((acc, record) => {
      if (record.outcome === 'success') acc.success += record.weight;
      if (record.outcome !== null) acc.total += record.weight;
      return acc;
    }, { success: 0, total: 0 });
    if (weighted.total <= 0) return null;

    const successes = top.filter(r => r.outcome === 'success').length;
    const ratio = successes / top.length;
    const weightedRatio = weighted.success / weighted.total;
    const nearest = top[0];
    return {
      ratio,
      weightedRatio,
      samples: top.length,
      weightedSamples: roundNumber(weighted.total, 4),
      closestDistance: roundNumber(nearest?.dist, 4),
    };
  }

  updateOutcomes(symbol, currentProfit, profitThreshold) {
    if (!this.isEnabled()) return;
    const now = Date.now();
    let updated = false;
    const threshold = Number.isFinite(profitThreshold) ? profitThreshold : 0;
    for (const record of this.records) {
      if (record.symbol !== symbol) continue;
      if (record.outcome !== null) continue;
      if (now - record.timestamp < LEARNING_MEMORY_OUTCOME_DELAY_MS) continue;
      if (record.profitAtDecision === null) continue;
      const profitChange = currentProfit - record.profitAtDecision;
      record.outcome = profitChange > threshold ? 'success' : 'failure';
      record.outcomeAt = now;
      record.outcomeDelta = profitChange;
      updated = true;
    }
    if (updated) this.save();
  }

  enrichContext(context, candleSummary) {
    const features = this.extractFeatures(context);
    features.symbol = context.symbol || 'unknown';
    this.enrichContextFeatures(features, candleSummary);
    return features;
  }
}

// ------------------------------
//  Gemini Grid Validation
// ------------------------------
class AIGridValidator {
  static cache = new Map();
  static MAX_CACHE_SIZE = 100;
  static lastDecisionBySymbol = new Map();
  static rateLimitedUntil = 0;

  constructor(exchange) {
    this.exchange = exchange;
    this.model = null;
    if (AI_VALIDATION_ENABLED) {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('AI_VALIDATION_ENABLED=true needs GEMINI_API_KEY.');
      }
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    }
    if (LEARNING_MEMORY_ENABLED) {
      this.learningMemory = new LearningMemory();
    } else {
      this.learningMemory = null;
    }
  }

  static allow(reason = 'AI validation disabled') {
    return { allowTrading: true, allowBuy: true, allowSell: true, confidence: 100, reason };
  }

  static block(reason, confidence = 0) {
    return { allowTrading: false, allowBuy: false, allowSell: false, confidence, reason };
  }

  blockAndRemember(symbol, cacheKey, reason, confidence = 0) {
    const decision = AIGridValidator.block(reason, confidence);
    this.setCached(cacheKey, decision);
    this.rememberDecision(symbol, decision);
    return decision;
  }

  applyConfidenceRules(decision) {
    const conf = decision.confidence;
    if (conf < 50) {
      decision.allowTrading = false;
      decision.allowBuy = false;
      decision.allowSell = false;
      decision.reason = `Auto-blocked: confidence too low (${conf.toFixed(1)}%) - extreme uncertainty`;
    } else if (conf < 70) {
      if (!decision.allowTrading) decision.allowBuy = decision.allowSell = false;
    }
    return decision;
  }

  cacheKey(symbol, currentPrice, levels) {
    const bucket = Math.floor(Date.now() / AI_VALIDATION_CACHE_TTL_MS);
    const rangeKey = `${roundNumber(levels[0])}-${roundNumber(levels[levels.length - 1])}`;
    const priceBucket = this.priceBucket(currentPrice, levels);
    return `${symbol}|${AI_VALIDATION_TIMEFRAME}|${bucket}|${priceBucket}|${rangeKey}`;
  }

  priceBucket(currentPrice, levels) {
    const lower = Number(levels[0]);
    const upper = Number(levels[levels.length - 1]);
    let gridStepPct = AI_VALIDATION_PRICE_BUCKET_PCT;
    if (lower > 0 && levels.length > 1) {
      gridStepPct = Math.abs((Number(levels[1]) - lower) / lower) * 100;
    }
    const bucketPct = Math.max(AI_VALIDATION_PRICE_BUCKET_PCT, gridStepPct / 2, 0.01);
    const bucketSize = currentPrice * (bucketPct / 100);
    const bucketedPrice = bucketSize > 0 ? Math.round(currentPrice / bucketSize) * bucketSize : currentPrice;
    const position = upper > lower ? Math.round(((currentPrice - lower) / (upper - lower)) * GRID_COUNT) : 0;
    return `${roundNumber(bucketedPrice)}|pos=${position}`;
  }

  getCached(key) {
    const entry = AIGridValidator.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      AIGridValidator.cache.delete(key);
      AIGridValidator.cache.set(key, entry);
      return entry.value;
    }
    if (entry) AIGridValidator.cache.delete(key);
    return null;
  }

  setCached(key, value) {
    const now = Date.now();
    for (const [cachedKey, entry] of AIGridValidator.cache.entries()) {
      if (!entry || entry.expiresAt <= now) AIGridValidator.cache.delete(cachedKey);
    }
    if (AIGridValidator.cache.has(key)) AIGridValidator.cache.delete(key);
    if (AIGridValidator.cache.size >= AIGridValidator.MAX_CACHE_SIZE) {
      const leastRecentlyUsed = AIGridValidator.cache.keys().next().value;
      AIGridValidator.cache.delete(leastRecentlyUsed);
    }
    AIGridValidator.cache.set(key, { value, expiresAt: now + AI_VALIDATION_CACHE_TTL_MS });
  }

  getLastDecisionEntry(symbol, allowStale = false) {
    const entry = AIGridValidator.lastDecisionBySymbol.get(symbol);
    if (!entry) return null;
    const age = Date.now() - entry.at;
    if (allowStale || age < AI_VALIDATION_CACHE_TTL_MS) return entry;
    return null;
  }

  getLastDecision(symbol, allowStale = false) {
    return this.getLastDecisionEntry(symbol, allowStale)?.value || null;
  }

  rememberDecision(symbol, decision) {
    AIGridValidator.lastDecisionBySymbol.set(symbol, { value: decision, at: Date.now() });
  }

  isRateLimitError(err) {
    const message = String(err?.message || err || '').toLowerCase();
    return err?.status === 429 ||
      err?.code === 429 ||
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('quota') ||
      message.includes('resource_exhausted');
  }

  summarizeCandles(ohlcv) {
    if (!ohlcv.length) return {};
    const closes = ohlcv.map(c => Number(c[4]));
    const highs = ohlcv.map(c => Number(c[2]));
    const lows = ohlcv.map(c => Number(c[3]));
    const volumes = ohlcv.map(c => Number(c[5]));
    const first = closes[0];
    const last = closes[closes.length - 1];
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const avgVolume = volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
    const recentVolume = volumes.slice(-10).reduce((sum, value) => sum + value, 0) / Math.min(10, volumes.length);
    return {
      firstClose: roundNumber(first),
      lastClose: roundNumber(last),
      changePct: roundNumber(((last - first) / first) * 100, 4),
      high: roundNumber(high),
      low: roundNumber(low),
      rangePct: roundNumber(((high - low) / last) * 100, 4),
      avgVolume: roundNumber(avgVolume, 4),
      recentVolume: roundNumber(recentVolume, 4),
      volumeRatio: avgVolume > 0 ? recentVolume / avgVolume : 1,
    };
  }

  buildPrompt(symbol, context, candleSummary) {
    const {
      currentPrice,
      lower,
      upper,
      levels,
      trailingUpJustShifted = false,
      trailingDownJustShifted = false,
    } = context;
    const distLowerPct = ((currentPrice - lower) / currentPrice) * 100;
    const distUpperPct = ((upper - currentPrice) / currentPrice) * 100;
    const { changePct = 0, rangePct = 0, recentVolume = 0, avgVolume = 0 } = candleSummary;
    const volumeRatio = avgVolume > 0 ? recentVolume / avgVolume : 1;
    const trend = changePct > 0 ? 'UPTREND' : changePct < 0 ? 'DOWNTREND' : 'RANGING';

    return `
You validate whether a Binance spot grid bot may place new orders in a ${trend} market.

Return ONLY valid JSON (no markdown, no explanation):
{
  "allowTrading": true/false,
  "allowBuy": true/false,
  "allowSell": true/false,
  "confidence": 0-100,
  "reason": "specific reason (max 100 chars)"
}

DECISION FRAMEWORK:
1. VOLATILITY FILTER (rangePct = ${rangePct.toFixed(2)}%):
   - Block if rangePct > 8% (extreme volatility = unsafe grid)
   - Use caution if rangePct > 5% (elevated volatility)
   
2. VOLUME FILTER (volume ratio = ${volumeRatio.toFixed(2)}x):
   - Block if recent volume < 50% of average (liquidity warning)

3. TREND ANALYSIS (change = ${changePct.toFixed(2)}%):
   - STRONG TREND: |changePct| > 5% = directional pressure
     * In UPTREND: allowSell = false
     * In DOWNTREND: allowBuy = false
   - RANGING: |changePct| < 2% = grid optimal

4. PRICE POSITION:
   - Distance to Lower: ${distLowerPct.toFixed(1)}%
   - Distance to Upper: ${distUpperPct.toFixed(1)}%
   - If near bound (<5% away): evaluate trend before allowing that direction

5. TRAILING SHIFTS:
   - Trailing Up Just Shifted: ${trailingUpJustShifted}
   - Trailing Down Just Shifted: ${trailingDownJustShifted}
   - Assess new market regime after shift
   - Do not block solely because price is near the new upper bound
   - Do not block solely because price is near the new lower bound

Be conservative. Protect capital first.
`;
  }

  parseResponse(text) {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object in Gemini response');
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const confidence = Number(parsed.confidence);
    const allowTrading = parsed.allowTrading === true;
    const allowBuy = parsed.allowBuy === true;
    const allowSell = parsed.allowSell === true;
    const confVal = Number.isFinite(confidence) ? confidence : 0;
    return {
      allowTrading,
      allowBuy,
      allowSell,
      confidence: confVal,
      reason: String(parsed.reason || 'no reason').slice(0, 200),
    };
  }

  async validate(symbol, context, options = {}, profit = null) {
    if (!AI_VALIDATION_ENABLED) {
      const decision = AIGridValidator.allow();
      this.rememberDecision(symbol, decision);
      if (this.learningMemory) {
        this.learningMemory.recordDecision(symbol, context, decision, profit);
      }
      return decision;
    }

    const { ignoreMinInterval = false } = options;
    const cacheKey = this.cacheKey(symbol, context.currentPrice, context.levels);
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const lastDecision = this.getLastDecisionEntry(symbol);
    if (!ignoreMinInterval && lastDecision && Date.now() - lastDecision.at < AI_VALIDATION_MIN_INTERVAL_MS) {
      return lastDecision.value;
    }

    if (AIGridValidator.rateLimitedUntil > Date.now()) {
      const stale = this.getLastDecision(symbol, true);
      if (stale) return stale;
      return AIGridValidator.block('AI validation skipped: Gemini rate-limit backoff active');
    }

    try {
      const ohlcv = await retry(
        () => this.exchange.fetchOHLCV(symbol, AI_VALIDATION_TIMEFRAME, undefined, AI_VALIDATION_LOOKBACK),
        Math.max(AI_VALIDATION_RETRIES, 1)
      );
      const candleSummary = this.summarizeCandles(ohlcv);
      const prompt = this.buildPrompt(symbol, context, candleSummary);
      let decision;
      for (let attempt = 1; attempt <= AI_VALIDATION_RETRIES + 1; attempt++) {
        try {
          const result = await withTimeout(
            this.model.generateContent(prompt),
            AI_VALIDATION_TIMEOUT_MS,
            `Gemini validation timed out after ${AI_VALIDATION_TIMEOUT_MS}ms`
          );
          decision = this.parseResponse(result.response.text());
          this.applyConfidenceRules(decision);
          if (decision.confidence < AI_MIN_CONFIDENCE) {
            decision = this.blockAndRemember(
              symbol,
              cacheKey,
              `Low AI confidence: ${decision.reason}`,
              decision.confidence
            );
          } else {
            this.setCached(cacheKey, decision);
            this.rememberDecision(symbol, decision);
          }
          break;
        } catch (err) {
          if (this.isRateLimitError(err)) {
            AIGridValidator.rateLimitedUntil = Date.now() + AI_VALIDATION_BACKOFF_MS;
            const stale = this.getLastDecision(symbol, true);
            if (stale) return stale;
            throw err;
          }
          if (attempt > AI_VALIDATION_RETRIES) throw err;
          await sleep(1000 * attempt);
        }
      }

      // ---- Learning Memory Integration ----
      if (this.learningMemory && decision) {
        const features = this.learningMemory.enrichContext(context, candleSummary);
        features.symbol = symbol;
        const queryResult = this.learningMemory.querySimilarWithFeatures(features);
        if (queryResult && queryResult.samples >= LEARNING_MEMORY_MIN_SAMPLES) {
          const successRatio = Number.isFinite(queryResult.weightedRatio) ? queryResult.weightedRatio : queryResult.ratio;
          const factor = 0.85 + (successRatio * 0.3);
          const oldConfidence = decision.confidence;
          decision.confidence = Math.min(100, Math.max(0, decision.confidence * factor));
          const direction = factor > 1 ? 'boosted' : (factor < 1 ? 'reduced' : 'unchanged');
          const pctSuccess = (successRatio * 100).toFixed(0);
          decision.reason += ` | Memory: ${pctSuccess}% weighted success (${queryResult.samples} samples, closest=${queryResult.closestDistance}) -> confidence ${oldConfidence.toFixed(1)} -> ${decision.confidence.toFixed(1)} (${direction}, x${factor.toFixed(2)})`;
          console.log(
            `[MEMORY] ${symbol} weighted success ${pctSuccess}% (${queryResult.samples} samples, weighted=${queryResult.weightedSamples}) ` +
            `-> confidence ${oldConfidence.toFixed(1)} -> ${decision.confidence.toFixed(1)} (factor=${factor.toFixed(2)})`
          );
          if (decision.confidence < AI_MIN_CONFIDENCE) {
            decision = AIGridValidator.block(
              `Low AI confidence after memory adjustment: ${decision.reason}`,
              decision.confidence
            );
            decision.allowBuy = false;
            decision.allowSell = false;
          }
        }
        this.learningMemory.recordDecision(symbol, context, decision, profit, features);
        this.setCached(cacheKey, decision);
        this.rememberDecision(symbol, decision);
      }
      // ------------------------------------

      return decision;
    } catch (err) {
      const reason = this.isRateLimitError(err)
        ? `AI validation rate-limited; paused Gemini calls for ${Math.round(AI_VALIDATION_BACKOFF_MS / MINUTE_MS)}m`
        : `AI validation failed: ${err.message}`;
      if (this.isRateLimitError(err)) {
        AIGridValidator.rateLimitedUntil = Date.now() + AI_VALIDATION_BACKOFF_MS;
      }
      return this.blockAndRemember(symbol, cacheKey, reason);
    }
  }
}

// ------------------------------
//  Binance-Style Spot Grid Engine
// ------------------------------
class SpotGridEngine {
  constructor() {
    this.exchange = ExchangeManager.getInstance();
    this.aiValidator = new AIGridValidator(this.exchange);
    this.state = new GridState();
    this.isRunning = false;
    this.symbolLocks = new Map();
    this.pendingOrderLevels = new Set();
    this.rangeResetSymbols = new Set();
    this.circuitBreaker = { errors: 0, pausedUntil: 0 };
  }

  async init() {
    await retry(() => this.exchange.loadMarkets());
    for (const symbol of SYMBOLS) {
      try {
        this.ensureMarket(symbol);
        if (GRID_RECREATE_ON_START) await this.cancelGridOrders(symbol, 'recreate-on-start');
        await this.reconcileSymbol(symbol);
      } catch (err) {
        console.error(`[INIT] ${symbol}`, err);
        this.recordError();
      }
    }
  }

  ensureMarket(symbol) {
    if (!this.exchange.markets[symbol]) {
      throw new Error(`Symbol ${symbol} not found on Binance spot market.`);
    }
  }

  circuitAllows() {
    return this.circuitBreaker.pausedUntil <= Date.now();
  }

  recordError() {
    this.circuitBreaker.errors++;
    if (this.circuitBreaker.errors >= CIRCUIT_BREAKER_MAX_ERRORS) {
      this.circuitBreaker.pausedUntil = Date.now() + CIRCUIT_BREAKER_PAUSE_MS;
      this.circuitBreaker.errors = 0;
      console.warn(`[CIRCUIT] Too many errors. Paused ${CIRCUIT_BREAKER_PAUSE_MS / MINUTE_MS}m.`);
    }
  }

  recordSuccess() {
    this.circuitBreaker.errors = 0;
  }

  getOrderSizeUsdt() {
    if (GRID_TOTAL_INVESTMENT_USDT > 0) {
      return GRID_TOTAL_INVESTMENT_USDT / Math.max(GRID_COUNT, 1);
    }
    return GRID_ORDER_SIZE_USDT;
  }

  getLearningMemoryProfitThreshold() {
    // Auto-scale with the grid size so smaller bots do not need a manual env tweak.
    // Defaults to 0.5% of per-grid notional, with a small floor to avoid noise.
    return Math.max(0.1, this.getOrderSizeUsdt() * (LEARNING_MEMORY_PROFIT_THRESHOLD_PCT / 100));
  }

  buildRange(symbol, currentPrice) {
    const symState = this.state.getSymbol(symbol);
    const manualRange = hasManualGridRange();
    const resetAutoRange = !manualRange &&
      GRID_RESET_RANGE_ON_START &&
      !(this.rangeResetSymbols && this.rangeResetSymbols.has(symbol));
    const lower = manualRange
      ? GRID_LOWER_PRICE
      : Number((resetAutoRange ? 0 : symState.config.lower) || currentPrice * (1 - GRID_RANGE_PCT / 100));
    const upper = manualRange
      ? GRID_UPPER_PRICE
      : Number((resetAutoRange ? 0 : symState.config.upper) || currentPrice * (1 + GRID_RANGE_PCT / 100));
    if (lower <= 0 || upper <= 0 || lower >= upper) {
      throw new Error(`Invalid grid range. lower=${lower}, upper=${upper}`);
    }
    symState.config = {
      mode: GRID_MODE,
      count: GRID_COUNT,
      lower,
      upper,
      autoRange: !manualRange,
      orderSizeUsdt: this.getOrderSizeUsdt(),
    };
    if (resetAutoRange) {
      if (!this.rangeResetSymbols) this.rangeResetSymbols = new Set();
      this.rangeResetSymbols.add(symbol);
    }
    this.state.save();
    return { lower, upper };
  }

  getTrailingUpState(symbol) {
    const symState = this.state.getSymbol(symbol);
    if (!symState.trailingUp) symState.trailingUp = { shifts: 0, lastShiftAt: null };
    return symState.trailingUp;
  }

  getTrailingDownState(symbol) {
    const symState = this.state.getSymbol(symbol);
    if (!symState.trailingDown) symState.trailingDown = { shifts: 0, lastShiftAt: null };
    return symState.trailingDown;
  }

  calculateTrailingShift(currentPrice, lower, upper, direction) {
    if (GRID_MODE === 'GEOMETRIC') {
      const ratio = Math.pow(upper / lower, 1 / GRID_COUNT);
      if (!(ratio > 1)) return null;
      if (direction === 'up') {
        if (currentPrice < this.getTrailingUpTrigger(lower, upper)) return null;
        const steps = Math.max(1, Math.floor(Math.log(currentPrice / upper) / Math.log(ratio)));
        return {
          steps,
          lower: lower * Math.pow(ratio, steps),
          upper: upper * Math.pow(ratio, steps),
        };
      }
      if (currentPrice > this.getTrailingDownTrigger(lower, upper)) return null;
      const steps = Math.max(1, Math.floor(Math.log(lower / currentPrice) / Math.log(ratio)));
      return {
        steps,
        lower: lower / Math.pow(ratio, steps),
        upper: upper / Math.pow(ratio, steps),
      };
    }
    const stepSize = (upper - lower) / GRID_COUNT;
    if (!(stepSize > 0)) return null;
    if (direction === 'up') {
      if (currentPrice < this.getTrailingUpTrigger(lower, upper)) return null;
      const steps = Math.max(1, Math.floor((currentPrice - upper) / stepSize));
      return {
        steps,
        lower: lower + stepSize * steps,
        upper: upper + stepSize * steps,
      };
    }
    if (currentPrice > this.getTrailingDownTrigger(lower, upper)) return null;
    const steps = Math.max(1, Math.floor((lower - currentPrice) / stepSize));
    return {
      steps,
      lower: lower - stepSize * steps,
      upper: upper - stepSize * steps,
    };
  }

  getTrailingUpTrigger(lower, upper) {
    if (GRID_MODE === 'GEOMETRIC') {
      const ratio = Math.pow(upper / lower, 1 / GRID_COUNT);
      return upper * ratio;
    }
    return upper + ((upper - lower) / GRID_COUNT);
  }

  getTrailingDownTrigger(lower, upper) {
    if (GRID_MODE === 'GEOMETRIC') {
      const ratio = Math.pow(upper / lower, 1 / GRID_COUNT);
      return lower / ratio;
    }
    return lower - ((upper - lower) / GRID_COUNT);
  }

  shiftStoredLevelIndexes(symbol, offset) {
    const symState = this.state.getSymbol(symbol);

    const shiftedOrders = {};
    for (const [orderId, order] of Object.entries(symState.orders)) {
      shiftedOrders[orderId] = {
        ...order,
        levelIndex: Number(order.levelIndex) + offset,
      };
    }
    symState.orders = shiftedOrders;

    const shiftedBuys = {};
    for (const [levelIndex, buy] of Object.entries(symState.lastBuyByLevel)) {
      shiftedBuys[Number(levelIndex) + offset] = buy;
    }
    symState.lastBuyByLevel = shiftedBuys;
  }

  mergeBuyRecords(existing, incoming) {
    if (!existing) return { ...incoming };
    const existingAmount = Number(existing.amount) || 0;
    const incomingAmount = Number(incoming.amount) || 0;
    const amount = existingAmount + incomingAmount;
    const sellableAmount = numberOrZero(existing.sellableAmount ?? existing.amount) +
      numberOrZero(incoming.sellableAmount ?? incoming.amount);
    const totalCostQuote = (Number(existing.totalCostQuote) || 0) + (Number(incoming.totalCostQuote) || 0);
    const totalFeeQuote = (Number(existing.totalFeeQuote) || 0) + (Number(incoming.totalFeeQuote) || 0);
    return {
      ...existing,
      ...incoming,
      price: amount > 0 && totalCostQuote > 0 ? totalCostQuote / amount : Number(incoming.price ?? existing.price) || 0,
      amount,
      sellableAmount,
      totalCostQuote,
      totalFeeQuote,
      at: Date.parse(incoming.at || 0) > Date.parse(existing.at || 0) ? incoming.at : existing.at,
    };
  }

  clampBuyLevelIndex(levelIndex) {
    return Math.max(0, Math.min(GRID_COUNT - 1, Number(levelIndex)));
  }

  hasActiveOrderAtLevel(symState, side, levelIndex) {
    return Object.values(symState.orders).some(order =>
      String(order.side).toLowerCase() === side &&
      Number(order.levelIndex) === Number(levelIndex)
    );
  }

  countActiveOrders(symState, side) {
    return Object.values(symState.orders).filter(order =>
      String(order.side).toLowerCase() === side
    ).length;
  }

  getPreciseOrderNumbers(symbol, price, amount) {
    const precisePrice = this.exchange.priceToPrecision(symbol, price);
    const preciseAmount = this.exchange.amountToPrecision(symbol, amount);
    const priceNum = Number(precisePrice);
    const amountNum = Number(preciseAmount);
    return {
      precisePrice,
      preciseAmount,
      priceNum,
      amountNum,
      notional: priceNum * amountNum,
    };
  }

  async applyTrailingRangeShift(symbol, lower, upper, shift, direction) {
    // 1. Cancel existing grid orders first (so we don't leave stale orders if something fails)
    const cancelResult = await this.cancelGridOrders(symbol, `trailing-${direction}`);
    if (cancelResult.failed.length > 0) {
      const failedIds = cancelResult.failed.map(failure => failure.id).join(', ');
      throw new Error(`Trailing ${direction} shift aborted; failed to cancel grid orders: ${failedIds}`);
    }

    // 2. Now update state
    const symState = this.state.getSymbol(symbol);
    const trailingState = direction === 'up'
      ? this.getTrailingUpState(symbol)
      : this.getTrailingDownState(symbol);
    const offset = direction === 'up' ? -shift.steps : shift.steps;

    if (Object.keys(symState.orders).length > 0) {
      console.warn(
        `[TRAILING] ${symbol} had ${Object.keys(symState.orders).length} managed order(s) after cancellation; clearing stale local metadata`
      );
      symState.orders = {};
    }

    symState.config.lower = shift.lower;
    symState.config.upper = shift.upper;

    const cleanedBuys = {};
    for (const [idx, buy] of Object.entries(symState.lastBuyByLevel)) {
      const newIdx = Number(idx) + offset;
      const exitIdx = this.clampBuyLevelIndex(newIdx);
      cleanedBuys[exitIdx] = this.mergeBuyRecords(cleanedBuys[exitIdx], buy);
      if (exitIdx !== newIdx) {
        console.warn(
          `[TRAILING] Keeping buy at shifted level ${newIdx} as boundary buy level ${exitIdx} after ${direction} shift`
        );
      }
    }
    symState.lastBuyByLevel = cleanedBuys;
    trailingState.shifts += shift.steps;
    trailingState.lastShiftAt = new Date().toISOString();
    this.state.save();

    console.log(
      `[TRAILING ${direction.toUpperCase()}] ${symbol} shifted ${shift.steps} grid(s): ` +
      `${roundNumber(lower)}-${roundNumber(upper)} -> ${roundNumber(shift.lower)}-${roundNumber(shift.upper)}`
    );
    await this.sendAlert(
      `[GRID TRAILING ${direction.toUpperCase()}] ${symbol} shifted ${shift.steps} grid(s) to ` +
      `${roundNumber(shift.lower)}-${roundNumber(shift.upper)}`
    );

    return { lower: shift.lower, upper: shift.upper };
  }

  async maybeTrailUpRange(symbol, currentPrice, lower, upper) {
    if (!GRID_TRAILING_UP_ENABLED || hasManualGridRange()) return null;
    const trailingState = this.getTrailingUpState(symbol);
    const lastShiftAt = Date.parse(trailingState.lastShiftAt || 0);
    if (GRID_TRAILING_UP_COOLDOWN_MS > Date.now() - lastShiftAt) return null;
    const shift = this.calculateTrailingShift(currentPrice, lower, upper, 'up');
    if (!shift) return null;
    try {
      return await this.applyTrailingRangeShift(symbol, lower, upper, shift, 'up');
    } catch (err) {
      console.error(`[TRAILING] Up shift failed for ${symbol}:`, err);
      return null;
    }
  }

  async maybeTrailDownRange(symbol, currentPrice, lower, upper) {
    if (!GRID_TRAILING_DOWN_ENABLED || hasManualGridRange()) return null;
    const trailingState = this.getTrailingDownState(symbol);
    const lastShiftAt = Date.parse(trailingState.lastShiftAt || 0);
    if (GRID_TRAILING_DOWN_COOLDOWN_MS > Date.now() - lastShiftAt) return null;
    const shift = this.calculateTrailingShift(currentPrice, lower, upper, 'down');
    if (!shift) return null;
    try {
      return await this.applyTrailingRangeShift(symbol, lower, upper, shift, 'down');
    } catch (err) {
      console.error(`[TRAILING] Down shift failed for ${symbol}:`, err);
      return null;
    }
  }

  buildLevels(lower, upper) {
    if (GRID_COUNT < 2) throw new Error('GRID_COUNT minimal 2.');
    if (GRID_MODE === 'GEOMETRIC') {
      const ratio = Math.pow(upper / lower, 1 / GRID_COUNT);
      const levels = Array.from({ length: GRID_COUNT + 1 }, (_, i) => lower * Math.pow(ratio, i));
      levels[0] = lower;
      levels[GRID_COUNT] = upper;
      return levels;
    }
    const step = (upper - lower) / GRID_COUNT;
    const levels = Array.from({ length: GRID_COUNT + 1 }, (_, i) => lower + step * i);
    levels[0] = lower;
    levels[GRID_COUNT] = upper;
    return levels;
  }

  getLevelIndex(levels, price) {
    return levels.reduce((closestIndex, level, index) => {
      const currentDistance = Math.abs(level - price);
      const closestDistance = Math.abs(levels[closestIndex] - price);
      return currentDistance < closestDistance ? index : closestIndex;
    }, 0);
  }

  getNearestLevels(levels, currentPrice, side, limit) {
    const isBuy = side === 'buy';
    return levels
      .map((price, index) => ({ price, index }))
      .filter(level => isBuy ? level.price < currentPrice : level.price > currentPrice)
      .sort((a, b) => isBuy ? b.price - a.price : a.price - b.price)
      .slice(0, limit);
  }

  async fetchContext(symbol) {
    const [ticker, openOrders, balance] = await Promise.all([
      retry(() => this.exchange.fetchTicker(symbol)),
      retry(() => this.exchange.fetchOpenOrders(symbol)),
      retry(() => this.exchange.fetchBalance()),
    ]);
    const currentPrice = Number(ticker.last);
    const { lower, upper } = this.buildRange(symbol, currentPrice);
    const levels = this.buildLevels(lower, upper);
    return { ticker, currentPrice, openOrders, balance, lower, upper, levels };
  }

  getManagedOpenOrders(symbol, openOrders) {
    const symState = this.state.getSymbol(symbol);
    const managedIds = new Set(Object.keys(symState.orders));
    const managed = [];
    for (const order of openOrders) {
      const orderId = String(order.id);
      const levelIndex = this.getBotOrderLevel(order);
      if (!managedIds.has(orderId) && levelIndex !== null) {
        this.state.rememberOrder(symbol, order, { levelIndex });
        managedIds.add(orderId);
        console.warn(`[RECOVER] ${symbol} adopted order ${orderId} level=${levelIndex}`);
      }
      if (managedIds.has(orderId)) managed.push(order);
    }
    return managed;
  }

  getOrderClientId(order) {
    return String(order.clientOrderId || order.info?.clientOrderId || order.info?.origClientOrderId || '');
  }

  getBotOrderLevel(order) {
    const match = this.getOrderClientId(order).match(/^grid-[a-z0-9]+-[bs]-(\d+)-/);
    return match ? Number(match[1]) : null;
  }

  makeClientOrderId(symbol, side, levelIndex) {
    const market = symbol.replace(/[^a-z0-9]/gi, '').slice(0, 10).toLowerCase();
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return `grid-${market}-${side[0]}-${levelIndex}-${nonce}`.slice(0, 36);
  }

  async cancelGridOrders(symbol, reason) {
    const result = { cancelled: [], failed: [] };
    if (!this.exchange?.fetchOpenOrders || !this.exchange?.cancelOrder) return result;
    const openOrders = await retry(() => this.exchange.fetchOpenOrders(symbol));
    const managed = this.getManagedOpenOrders(symbol, openOrders);
    for (const order of managed) {
      try {
        await retry(() => this.exchange.cancelOrder(order.id, symbol));
        this.state.forgetOrder(symbol, order.id);
        result.cancelled.push(String(order.id));
        console.log(`[CANCEL] ${symbol} ${order.side} ${order.id} | ${reason}`);
      } catch (err) {
        result.failed.push({ id: String(order.id), error: err });
        console.warn(`[CANCEL] Failed to cancel ${symbol} order ${order.id}: ${err.message}`);
      }
    }
    return result;
  }

  async cancelOrder(symbol, order, reason) {
    if (!this.exchange?.cancelOrder) return;
    await retry(() => this.exchange.cancelOrder(order.id, symbol));
    this.state.forgetOrder(symbol, order.id);
    console.log(`[CANCEL] ${symbol} ${order.side} ${order.id} | ${reason}`);
  }

  async createOrderWithFallback(symbol, side, amount, price, levelIndex) {
    const clientOrderId = this.makeClientOrderId(symbol, side, levelIndex);
    const orderParams = { newClientOrderId: clientOrderId };
    if (GRID_POST_ONLY) {
      orderParams.postOnly = true;
    }
    try {
      return await this.exchange.createLimitOrder(
        symbol,
        side,
        amount,
        price,
        orderParams
      );
    } catch (err) {
      if (GRID_POST_ONLY && err.message && err.message.includes('Post only order rejected')) {
        console.warn(`[POST-ONLY] ${symbol} ${side} level=${levelIndex} retrying without post-only flag`);
        delete orderParams.postOnly;
        return await this.exchange.createLimitOrder(
          symbol,
          side,
          amount,
          price,
          orderParams
        );
      }
      throw err;
    }
  }

  async placeLimit(symbol, side, levelIndex, price, amount) {
    const pendingKey = `${symbol}|${side}|${levelIndex}`;
    if (this.pendingOrderLevels.has(pendingKey)) {
      console.warn(`[SKIP] ${symbol} ${side.toUpperCase()} level=${levelIndex} | placement already in progress`);
      return null;
    }

    this.pendingOrderLevels.add(pendingKey);
    try {
      const {
        precisePrice,
        preciseAmount,
        priceNum: preciseNum,
        amountNum: preciseAmountNum,
        notional,
      } = this.getPreciseOrderNumbers(symbol, price, amount);
      const priceNum = Number(price);
      const priceDiffPct = Math.abs(preciseNum - priceNum) / priceNum * 100;
      if (priceDiffPct > GRID_PRICE_PRECISION_MAX_DEVIATION_PCT) {
        console.warn(
          `[SKIP] ${symbol} ${side.toUpperCase()} level=${levelIndex} price=${price} -> ${precisePrice} | precision adjustment too large (${priceDiffPct.toFixed(4)}%)`
        );
        return null;
      }

      if (side === 'sell') {
        const market = this.exchange.markets[symbol];
        const minCost = Number(market?.limits?.cost?.min || 0);
        if (minCost > 0 && notional < minCost - 1e-8) {
          console.warn(`[SKIP] ${symbol} SELL level=${levelIndex} | notional ${notional.toFixed(8)} below min ${minCost}, skipping order (dust)`);
          return null;
        }
      }

      if (!(preciseAmountNum > 0) || !(preciseNum > 0)) {
        console.warn(`[SKIP] ${symbol} ${side.toUpperCase()} level=${levelIndex} | amount or price rounded to zero`);
        return null;
      }

      const order = await this.createOrderWithFallback(symbol, side, preciseAmount, precisePrice, levelIndex);
      this.state.rememberOrder(symbol, order, { levelIndex });
      console.log(`[GRID] ${symbol} ${side.toUpperCase()} level=${levelIndex} amount=${preciseAmount} price=${precisePrice}${GRID_POST_ONLY ? ' (postOnly)' : ''}`);
      return order;
    } catch (err) {
      if (this.isInsufficientFundsError(err)) {
        console.warn(
          `[SKIP] ${symbol} ${side.toUpperCase()} level=${levelIndex} amount=${amount} price=${price} | insufficient balance`
        );
        return null;
      }
      if (this.isInvalidOrderAmountError(err)) {
        console.warn(
          `[SKIP] ${symbol} ${side.toUpperCase()} level=${levelIndex} amount=${amount} | invalid order amount: ${err.message}`
        );
        return null;
      }
      throw err;
    } finally {
      this.pendingOrderLevels.delete(pendingKey);
    }
  }

  isInsufficientFundsError(err) {
    const message = String(err?.message || err || '').toLowerCase();
    return err instanceof ccxt.InsufficientFunds ||
      err?.name === 'InsufficientFunds' ||
      message.includes('insufficient balance') ||
      message.includes('insufficient funds');
  }

  isInvalidOrderAmountError(err) {
    const message = String(err?.message || err || '').toLowerCase();
    return err instanceof ccxt.InvalidOrder ||
      err?.name === 'InvalidOrder' ||
      (message.includes('amount') && (
        message.includes('minimum amount') ||
        message.includes('precision') ||
        message.includes('must be greater')
      ));
  }

  getBaseFree(balance, symbol) {
    return Number(balance?.free?.[this.getBaseAsset(symbol)] || 0);
  }

  getQuoteFree(balance, symbol) {
    return Number(balance?.free?.[this.getQuoteAsset(symbol)] || 0);
  }

  getBaseAsset(symbol) {
    return symbol.split('/')[0];
  }

  getQuoteAsset(symbol) {
    return symbol.split('/')[1].split(':')[0];
  }

  getTradeFeeCurrency(trade) {
    return String(trade.fee?.currency || trade.info?.commissionAsset || '').toUpperCase();
  }

  getTradeFeeCost(trade) {
    return Number(trade.fee?.cost || trade.info?.commission || 0);
  }

  feeToQuote(feeCost, feeCurrency, price, baseAsset, quoteAsset) {
    if (feeCurrency === quoteAsset) return feeCost;
    if (feeCurrency === baseAsset) return feeCost * price;
    console.warn(`[FEE] Unknown fee currency ${feeCurrency}, cannot convert to ${quoteAsset}. Fee amount = ${feeCost}`);
    return 0;
  }

  async handleBuyFill(symbol, levels, aiDecision, symState, trade, orderMeta, openOrderIds) {
    const price = Number(trade.price);
    const amount = Number(trade.amount);
    const levelIndex = Number(orderMeta.levelIndex);
    const feeCost = this.getTradeFeeCost(trade);
    const feeCurrency = this.getTradeFeeCurrency(trade);
    const base = this.getBaseAsset(symbol);
    const quote = this.getQuoteAsset(symbol);
    const sellableAmount = this.amountAfterBuyFee(symbol, trade);
    const costQuote = price * amount;
    const feeQuote = this.feeToQuote(feeCost, feeCurrency, price, base, quote);
    
    symState.lastBuyByLevel[levelIndex] = this.mergeBuyRecords(
      symState.lastBuyByLevel[levelIndex],
      {
        price,
        amount,
        sellableAmount,
        totalCostQuote: costQuote,
        totalFeeQuote: feeQuote,
        at: trade.datetime,
      }
    );
    
    this.state.data.totals.filledBuys++;
    this.state.save();
    this.forgetOrderIfClosed(symState, trade, openOrderIds);
    this.state.markProcessedTrade(symbol, this.getTradeId(trade));
    await this.sendAlert(`[GRID BUY] ${symbol} amount=${amount} @ ${price} | sellable=${sellableAmount} | fee=${feeQuote.toFixed(4)} ${quote}`);
    if (!GRID_REFILL_ON_FILLED || !aiDecision.allowTrading || !aiDecision.allowSell || levelIndex + 1 >= levels.length) return;
    const sellLevelIndex = levelIndex + 1;
    const sellPrice = levels[sellLevelIndex];

    // Ambil total sellable amount dari lastBuyByLevel (sudah digabung oleh mergeBuyRecords)
    const totalSellable = Math.max(0, Number(symState.lastBuyByLevel[levelIndex]?.sellableAmount ?? symState.lastBuyByLevel[levelIndex]?.amount) || 0);
    if (!(totalSellable > 0)) {
      console.warn(`[SKIP] ${symbol} SELL refill level=${sellLevelIndex} | sellable amount zero after fee`);
      return;
    }

    const market = this.exchange.markets[symbol];
    const minCost = Number(market?.limits?.cost?.min || 0);
    const { notional } = this.getPreciseOrderNumbers(symbol, sellPrice, totalSellable);
    if (minCost > 0 && notional < minCost - 1e-8) {
      console.warn(
        `[SKIP] ${symbol} SELL refill level=${sellLevelIndex} | notional ${notional.toFixed(8)} below min ${minCost}, keeping buy record for later retry`
      );
      return;
    }

    // Jika sell order sudah aktif di level ini, cek apakah amount-nya perlu diupdate
    if (this.hasActiveOrderAtLevel(symState, 'sell', sellLevelIndex)) {
      // Cari order aktif di level ini
      const existingOrder = Object.values(symState.orders).find(o =>
        String(o.side).toLowerCase() === 'sell' && Number(o.levelIndex) === sellLevelIndex
      );
      const existingAmount = Number(existingOrder?.amount || 0);

      // Hitung selisih: berapa amount baru yang perlu ditambahkan
      const { preciseAmount: preciseTotalSellable } = this.getPreciseOrderNumbers(symbol, sellPrice, totalSellable);
      const preciseTotalNum = Number(preciseTotalSellable);

      if (existingOrder && preciseTotalNum > existingAmount + 1e-8) {
        // Ada kelebihan amount dari buy baru — cancel order lama, pasang ulang dengan amount total
        console.log(
          `[UPDATE] ${symbol} SELL level=${sellLevelIndex} | amount update ${existingAmount} -> ${preciseTotalNum} (buy accumulated)`
        );
        try {
          await this.cancelOrder(symbol, existingOrder, `sell amount update level=${sellLevelIndex}`);
          await this.placeLimit(symbol, 'sell', sellLevelIndex, sellPrice, totalSellable);
        } catch (err) {
          console.warn(`[UPDATE] ${symbol} SELL level=${sellLevelIndex} cancel+replace failed: ${err.message}`);
        }
      } else {
        console.warn(`[SKIP] ${symbol} SELL refill level=${sellLevelIndex} | sell order already active with sufficient amount`);
      }
      return;
    }

    if (this.countActiveOrders(symState, 'sell') >= GRID_MAX_ACTIVE_SELL_ORDERS) {
      console.warn(`[SKIP] ${symbol} SELL refill level=${sellLevelIndex} | active sell order limit reached`);
      return;
    }

    await this.placeLimit(symbol, 'sell', sellLevelIndex, sellPrice, totalSellable);
  }

  async handleSellFill(symbol, levels, aiDecision, symState, trade, orderMeta, openOrderIds) {
    const price = Number(trade.price);
    const amount = Number(trade.amount);
    const levelIndex = Number(orderMeta.levelIndex);
    const buyLevelIndex = levelIndex - 1;
    const buy = symState.lastBuyByLevel[buyLevelIndex];
    if (!buy) {
      console.warn(`[SELL] ${symbol} level ${levelIndex} has no corresponding buy record. Skipping profit calculation.`);
      this.forgetOrderIfClosed(symState, trade, openOrderIds);
      this.state.markProcessedTrade(symbol, this.getTradeId(trade));
      return;
    }
    
    const base = this.getBaseAsset(symbol);
    const quote = this.getQuoteAsset(symbol);
    const feeCost = this.getTradeFeeCost(trade);
    const feeCurrency = this.getTradeFeeCurrency(trade);
    const proceedsQuote = price * amount;
    const feeQuote = this.feeToQuote(feeCost, feeCurrency, price, base, quote);
    
    const totalBuyAmount = buy.amount;
    const sellableAtBuy = buy.sellableAmount ?? totalBuyAmount;
    if (!(sellableAtBuy > 0)) {
      console.warn(`[SELL] ${symbol} level ${levelIndex} buy record has zero sellable amount. Skipping profit calculation.`);
      this.forgetOrderIfClosed(symState, trade, openOrderIds);
      this.state.markProcessedTrade(symbol, this.getTradeId(trade));
      return;
    }
    const proportion = Math.min(amount / sellableAtBuy, 1.0);
    const allocatedBuyCost = buy.totalCostQuote * proportion;
    const allocatedBuyFee = buy.totalFeeQuote * proportion;
    const profit = (proceedsQuote - feeQuote) - (allocatedBuyCost + allocatedBuyFee);
    
    symState.realizedGridProfit += profit;
    this.state.data.totals.realizedGridProfit += profit;
    this.state.data.totals.filledSells++;
    this.forgetOrderIfClosed(symState, trade, openOrderIds);
    
    const remainingSellable = sellableAtBuy - amount;
    if (remainingSellable > 0) {
      const newProportion = remainingSellable / sellableAtBuy;
      buy.sellableAmount = remainingSellable;
      buy.totalCostQuote = buy.totalCostQuote * newProportion;
      buy.totalFeeQuote = buy.totalFeeQuote * newProportion;
      buy.amount = remainingSellable;
    } else {
      delete symState.lastBuyByLevel[buyLevelIndex];
    }
    
    this.state.save();
    this.state.markProcessedTrade(symbol, this.getTradeId(trade));
    await this.sendAlert(`[GRID SELL] ${symbol} amount=${amount} @ ${price} | profit=${profit.toFixed(4)} ${quote} | fee=${feeQuote.toFixed(4)} ${quote}`);
    
    if (GRID_REFILL_ON_FILLED && aiDecision.allowTrading && aiDecision.allowBuy && levelIndex - 1 >= 0) {
      const buyPrice = levels[levelIndex - 1];
      if (this.hasActiveOrderAtLevel(symState, 'buy', levelIndex - 1)) {
        console.warn(`[SKIP] ${symbol} BUY refill level=${levelIndex - 1} | buy order already active`);
        return;
      }
      if (this.countActiveOrders(symState, 'buy') >= GRID_MAX_ACTIVE_BUY_ORDERS) {
        console.warn(`[SKIP] ${symbol} BUY refill level=${levelIndex - 1} | active buy order limit reached`);
        return;
      }
      let amountToBuy = this.amountForBuy(symbol, buyPrice);
      let cost = amountToBuy * buyPrice;
      if (!(amountToBuy > 0)) {
        console.warn(`[SKIP] ${symbol} BUY refill level=${levelIndex - 1} | investment cap reached`);
        return;
      }
      const market = this.exchange.markets[symbol];
      const minCost = Number(market?.limits?.cost?.min || 0);
      if (minCost > 0 && cost < minCost - 1e-8) {
        amountToBuy = minCost / buyPrice;
        cost = amountToBuy * buyPrice;
        if (cost < minCost - 1e-8) {
          console.warn(`[SKIP] ${symbol} BUY refill level=${levelIndex - 1} | cannot meet min notional ${minCost}`);
          return;
        }
      }
      const remainingInvestmentUsdt = this.getRemainingInvestmentUsdt(symbol);
      const precise = this.getPreciseOrderNumbers(symbol, buyPrice, amountToBuy);
      if (precise.notional > remainingInvestmentUsdt + 1e-8) {
        console.warn(
          `[SKIP] ${symbol} BUY refill level=${levelIndex - 1} | rounded cost ${precise.notional.toFixed(8)} exceeds remaining investment ${roundNumber(remainingInvestmentUsdt, 8)}`
        );
        return;
      }
      await this.placeLimit(symbol, 'buy', levelIndex - 1, buyPrice, amountToBuy);
    }
  }

  getTradeId(trade) {
    return String(trade.id || `${trade.order}-${trade.timestamp}`);
  }

  forgetOrderIfClosed(symState, trade, openOrderIds) {
    if (!openOrderIds.has(String(trade.order))) {
      delete symState.orders[String(trade.order)];
      this.state.save();
    }
  }

  async fetchNewTrades(symbol, symState) {
    const since = symState.lastTradeTimestamp || 0;
    let allTrades = [];
    let from = since;
    let maxIterations = 10;
    let iteration = 0;
    while (iteration < maxIterations) {
      const trades = await retry(() => this.exchange.fetchMyTrades(symbol, from, TRADE_FETCH_LIMIT));
      if (!trades.length) break;
      allTrades = allTrades.concat(trades);
      const lastTimestamp = trades[trades.length - 1].timestamp;
      if (trades.length < TRADE_FETCH_LIMIT) break;
      // CCXT pagination is timestamp-based here; if many fills share one timestamp,
      // processedTrade() handles duplicates but the exchange may not expose a stable
      // cursor for every trade in that timestamp bucket.
      if (lastTimestamp === from) break;
      from = lastTimestamp + 1;
      iteration++;
      await sleep(200);
    }
    if (allTrades.length) {
      const maxTs = Math.max(...allTrades.map(t => t.timestamp));
      symState.lastTradeTimestamp = maxTs;
      this.state.save();
    }
    return allTrades;
  }

  async handleFilledTrades(symbol, levels, aiDecision) {
    const symState = this.state.getSymbol(symbol);
    const [trades, openOrders] = await Promise.all([
      this.fetchNewTrades(symbol, symState),
      retry(() => this.exchange.fetchOpenOrders(symbol)),
    ]);
    const openOrderIds = new Set(openOrders.map(order => String(order.id)));
    for (const trade of trades.sort((a, b) => a.timestamp - b.timestamp)) {
      const id = this.getTradeId(trade);
      if (this.state.processedTrade(symbol, id)) continue;
      if (!symState.orders[String(trade.order)]) {
        this.state.markProcessedTrade(symbol, id);
        continue;
      }
      const orderMeta = symState.orders[String(trade.order)];
      const side = String(trade.side).toLowerCase();
      if (side === 'buy') {
        await this.handleBuyFill(symbol, levels, aiDecision, symState, trade, orderMeta, openOrderIds);
      } else if (side === 'sell') {
        await this.handleSellFill(symbol, levels, aiDecision, symState, trade, orderMeta, openOrderIds);
      } else {
        this.forgetOrderIfClosed(symState, trade, openOrderIds);
        this.state.markProcessedTrade(symbol, id);
      }
    }
  }

  async enforceRangeExits(symbol, currentPrice) {
    if (STOP_LOSS_PRICE > 0 && currentPrice <= STOP_LOSS_PRICE) {
      await this.cancelGridOrders(symbol, `stop-loss ${STOP_LOSS_PRICE}`);
      await this.sendAlert(`[GRID STOP] ${symbol} price=${currentPrice} <= ${STOP_LOSS_PRICE}`);
      return false;
    }
    if (TAKE_PROFIT_PRICE > 0 && currentPrice >= TAKE_PROFIT_PRICE) {
      await this.cancelGridOrders(symbol, `take-profit ${TAKE_PROFIT_PRICE}`);
      await this.sendAlert(`[GRID TAKE PROFIT] ${symbol} price=${currentPrice} >= ${TAKE_PROFIT_PRICE}`);
      return false;
    }
    return true;
  }

  async withSymbolLock(symbol, fn) {
    const previous = this.symbolLocks.get(symbol) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    this.symbolLocks.set(symbol, current);
    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (this.symbolLocks.get(symbol) === current) this.symbolLocks.delete(symbol);
    }
  }

  async reconcileSymbol(symbol) {
    return this.withSymbolLock(symbol, () => this.reconcileSymbolUnlocked(symbol));
  }

  async reconcileSymbolUnlocked(symbol) {
    let context = await this.fetchContext(symbol);
    let { currentPrice, balance, lower, upper, levels } = context;

    const canContinue = await this.enforceRangeExits(symbol, currentPrice);
    if (!canContinue) return;

    const trailedUp = await this.maybeTrailUpRange(symbol, currentPrice, lower, upper);
    let trailedDown = null;
    let newContext = null;
    if (trailedUp) {
      newContext = await this.fetchContext(symbol);
      newContext.trailingUpJustShifted = true;
      ({ currentPrice, balance, lower, upper, levels } = newContext);
    } else {
      trailedDown = await this.maybeTrailDownRange(symbol, currentPrice, lower, upper);
      if (trailedDown) {
        newContext = await this.fetchContext(symbol);
        newContext.trailingDownJustShifted = true;
        ({ currentPrice, balance, lower, upper, levels } = newContext);
      }
    }
    const finalContext = newContext || context;
    finalContext.trailingUpJustShifted = !!trailedUp;
    finalContext.trailingDownJustShifted = !!trailedDown;

    const symState = this.state.getSymbol(symbol);
    const aiDecision = await this.aiValidator.validate(
      symbol,
      finalContext,
      { ignoreMinInterval: !!(trailedUp || trailedDown) },
      symState.realizedGridProfit
    );
    if (AI_VALIDATION_ENABLED) {
      console.log(
        `[AI] ${symbol}${trailedUp ? ' trailing-up' : ''}${trailedDown ? ' trailing-down' : ''} ` +
        `allow=${aiDecision.allowTrading} buy=${aiDecision.allowBuy} sell=${aiDecision.allowSell} ` +
        `confidence=${aiDecision.confidence.toFixed(1)} | ${aiDecision.reason}`
      );
    }

    await this.handleFilledTrades(symbol, levels, aiDecision);

    if (this.aiValidator.learningMemory) {
      this.aiValidator.learningMemory.updateOutcomes(
        symbol,
        symState.realizedGridProfit,
        this.getLearningMemoryProfitThreshold()
      );
    }

    // Re-read balances after any refill orders so placement loops use fresh funds.
    balance = await retry(() => this.exchange.fetchBalance());
    let freshOpenOrders = await retry(() => this.exchange.fetchOpenOrders(symbol));
    let managedOrders = this.getManagedOpenOrders(symbol, freshOpenOrders);

    if (GRID_CANCEL_OUT_OF_RANGE) {
      const recentThresholdMs = GRID_CANCEL_OUT_OF_RANGE_THRESHOLD_MS;
      for (const order of managedOrders) {
        const orderTimestamp = Date.parse(order.timestamp || order.datetime || 0);
        const orderAgeMs = Date.now() - orderTimestamp;
        if (orderAgeMs < recentThresholdMs) continue;
        const isValidGridOrder = this.isOrderCloseToPriceLevel(order.price, levels, this.exchange.markets[symbol]);
        if (isValidGridOrder) continue;
        if (!this.isOrderInsideRange(order, lower, upper)) {
          await this.cancelOrder(symbol, order, `outside range ${roundNumber(lower)}-${roundNumber(upper)}`);
        }
      }
      freshOpenOrders = await retry(() => this.exchange.fetchOpenOrders(symbol));
      managedOrders = this.getManagedOpenOrders(symbol, freshOpenOrders);
    }

    const activeBuyLevels = new Set();
    const activeSellLevels = new Set();
    for (const order of managedOrders) {
      const idx = this.getLevelIndex(levels, Number(order.price));
      if (order.side === 'buy') activeBuyLevels.add(idx);
      if (order.side === 'sell') activeSellLevels.add(idx);
    }
    // Tambahkan semua order dari state lokal ke activeLevels agar tidak double-place,
    // termasuk order lama yang masih aktif di exchange
    for (const order of Object.values(this.state.getSymbol(symbol).orders)) {
      if (order.side === 'buy') activeBuyLevels.add(Number(order.levelIndex));
      if (order.side === 'sell') activeSellLevels.add(Number(order.levelIndex));
    }

    const below = this.getNearestLevels(levels, currentPrice, 'buy', GRID_MAX_ACTIVE_BUY_ORDERS);
    const above = this.getNearestLevels(levels, currentPrice, 'sell', GRID_MAX_ACTIVE_SELL_ORDERS);

    let quoteFree = this.getQuoteFree(balance, symbol);
    let baseFree = this.getBaseFree(balance, symbol);
    let remainingInvestmentUsdt = this.getRemainingInvestmentUsdt(symbol);

    for (const level of below) {
      if (!aiDecision.allowTrading || !aiDecision.allowBuy) break;
      if (activeBuyLevels.has(level.index)) continue;
      let amount = this.amountForBuy(symbol, level.price, remainingInvestmentUsdt);
      let cost = amount * level.price;
      if (!(amount > 0)) {
        console.warn(`[SKIP] ${symbol} BUY level=${level.index} | investment cap reached`);
        break;
      }
      
      const market = this.exchange.markets[symbol];
      const minCost = Number(market?.limits?.cost?.min || 0);
      if (minCost > 0 && cost < minCost - 1e-8) {
        const requiredAmount = minCost / level.price;
        amount = this.exchange.amountToPrecision(symbol, requiredAmount);
        cost = Number(amount) * level.price;
        if (cost < minCost - 1e-8) {
          console.warn(`[SKIP] ${symbol} BUY level=${level.index} | cannot meet min notional ${minCost}`);
          break;
        }
      }

      const precise = this.getPreciseOrderNumbers(symbol, level.price, amount);
      cost = precise.notional;
      if (cost > remainingInvestmentUsdt + 1e-8) {
        console.warn(
          `[SKIP] ${symbol} BUY level=${level.index} | rounded cost ${cost.toFixed(8)} exceeds remaining investment ${roundNumber(remainingInvestmentUsdt, 8)}`
        );
        break;
      }
      if (quoteFree < cost) break;
      const order = await this.placeLimit(symbol, 'buy', level.index, level.price, amount);
      if (!order) break;
      quoteFree -= cost;
      remainingInvestmentUsdt = Math.max(0, remainingInvestmentUsdt - cost);
    }

    for (const level of above) {
      if (!aiDecision.allowTrading || !aiDecision.allowSell) break;
      if (this.countActiveOrders(this.state.getSymbol(symbol), 'sell') >= GRID_MAX_ACTIVE_SELL_ORDERS) {
        console.warn(`[SKIP] ${symbol} SELL level=${level.index} | active sell order limit (${GRID_MAX_ACTIVE_SELL_ORDERS}) reached`);
        break;
      }
      if (activeSellLevels.has(level.index)) continue;
      let trackedAmount = this.amountForTrackedSell(symbol, level.index);
      if (!(trackedAmount > 0)) continue;
      let amount = Math.min(trackedAmount, baseFree);
      if (!(amount > 0)) {
        console.warn(`[SKIP] ${symbol} SELL level=${level.index} | insufficient free base, checking farther sell levels`);
        continue;
      }
      
      const market = this.exchange.markets[symbol];
      const minCost = Number(market?.limits?.cost?.min || 0);
      const notional = amount * level.price;
      if (minCost > 0 && notional < minCost - 1e-8) {
        console.warn(`[SKIP] ${symbol} SELL level=${level.index} | notional too low (dust), keeping buy record for later retry`);
        continue;
      }
      
      const order = await this.placeLimit(symbol, 'sell', level.index, level.price, amount);
      if (!order) continue;
      baseFree -= amount;
    }

    console.log(
      `[SYNC] ${symbol} price=${roundNumber(currentPrice)} range=${roundNumber(lower)}-${roundNumber(upper)} ` +
      `orders=${managedOrders.length} totalProfit=${roundNumber(this.state.getSymbol(symbol).realizedGridProfit, 4)} ${this.getQuoteAsset(symbol)}`
    );
  }

  amountForTrackedSell(symbol, sellLevelIndex) {
    const symState = this.state.getSymbol(symbol);
    const buy = symState.lastBuyByLevel[sellLevelIndex - 1];
    if (!buy) return 0;
    return Math.max(0, Number(buy.sellableAmount ?? buy.amount) || 0);
  }

  getAllocatedInvestmentUsdt(symbol) {
    if (!(GRID_TOTAL_INVESTMENT_USDT > 0)) return 0;
    const symState = this.state.getSymbol(symbol);
    let allocated = 0;
    for (const buy of Object.values(symState.lastBuyByLevel)) {
      allocated += Number(buy.totalCostQuote) || 0;
    }
    for (const order of Object.values(symState.orders)) {
      if (String(order.side).toLowerCase() !== 'buy') continue;
      allocated += (Number(order.amount) || 0) * (Number(order.price) || 0);
    }
    return allocated;
  }

  getRemainingInvestmentUsdt(symbol) {
    if (!(GRID_TOTAL_INVESTMENT_USDT > 0)) return Infinity;
    return Math.max(0, GRID_TOTAL_INVESTMENT_USDT - this.getAllocatedInvestmentUsdt(symbol));
  }

  amountForBuy(symbol, price, availableInvestmentUsdt = this.getRemainingInvestmentUsdt(symbol)) {
    const market = this.exchange.markets[symbol];
    const minCost = Number(market?.limits?.cost?.min || 0);
    const targetNotional = Math.max(this.getOrderSizeUsdt(), minCost);
    const notional = Math.min(targetNotional, availableInvestmentUsdt);
    if (minCost > 0 && notional < minCost - 1e-8) return 0;
    if (!(notional > 0)) return 0;
    return notional / price;
  }

  isOrderInsideRange(order, lower, upper) {
    const price = Number(order.price);
    const rangeSize = upper - lower;
    const relativeEpsilon = Math.max(rangeSize * 0.0005, price * 0.00001);
    return price >= lower - relativeEpsilon && price <= upper + relativeEpsilon;
  }

  isOrderCloseToPriceLevel(orderPrice, levels, market) {
    const price = Number(orderPrice);
    const tickSize = market?.precision?.price || 0.00001;
    for (const level of levels) {
      if (Math.abs(price - level) <= tickSize * 1.5) return true;
    }
    return false;
  }

  amountAfterBuyFee(symbol, trade) {
    const amount = Number(trade.amount);
    const feeCost = this.getTradeFeeCost(trade);
    const feeCurrency = this.getTradeFeeCurrency(trade);
    const base = this.getBaseAsset(symbol).toUpperCase();
    let result = amount;
    if (feeCurrency === base) result = Math.max(0, amount - feeCost);
    return result;
  }

  async executeCycle() {
    if (this.isRunning) return;
    this.isRunning = true;
    let hadError = false;
    try {
      if (!this.circuitAllows() || killSwitchActive()) return;
      for (const symbol of SYMBOLS) {
        try {
          await this.reconcileSymbol(symbol);
        } catch (err) {
          hadError = true;
          console.error(`[CYCLE] Error on ${symbol}:`, err);
          this.recordError();
        }
      }
      if (!hadError) this.recordSuccess();
    } catch (err) {
      hadError = true;
      console.error('[CYCLE]', err);
      this.recordError();
    } finally {
      this.isRunning = false;
    }
  }

  async sendAlert(message) {
    if (!FONNTE_ENABLED || !FONNTE_TOKEN || !FONNTE_TARGET) return;
    try {
      const form = new URLSearchParams({
        target: FONNTE_TARGET,
        message,
        countryCode: FONNTE_COUNTRY_CODE,
      }).toString();
      await new Promise((resolve, reject) => {
        const req = https.request(FONNTE_API_URL, {
          method: 'POST',
          headers: {
            Authorization: FONNTE_TOKEN,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(form),
          },
          timeout: FONNTE_TIMEOUT_MS,
        }, response => {
          response.resume();
          response.once('end', () => {
            if (response.statusCode >= 200 && response.statusCode < 300) resolve();
            else reject(new Error(`Fonnte returned HTTP ${response.statusCode}`));
          });
        });
        req.once('timeout', () => req.destroy(new Error(`Fonnte request timed out after ${FONNTE_TIMEOUT_MS}ms`)));
        req.once('error', reject);
        req.end(form);
      });
    } catch (err) {
      console.warn('[ALERT] Failed:', err.message);
    }
  }

  async start() {
    console.log(`
[SPOT GRID BOT STARTED]
Mode: ${EXCHANGE_MODE.toUpperCase()}
Symbols: ${SYMBOLS.join(', ')}
Grid Mode: ${GRID_MODE}
Grid Count: ${GRID_COUNT}
Order Size: ${this.getOrderSizeUsdt()} USDT/grid
Range: ${GRID_LOWER_PRICE && GRID_UPPER_PRICE ? `${GRID_LOWER_PRICE}-${GRID_UPPER_PRICE}` : `auto +/-${GRID_RANGE_PCT}%`}
Trailing Range: ${GRID_TRAILING_RANGE_ENABLED ? 'ON (auto up/down)' : 'OFF'}
Trailing Up: ${GRID_TRAILING_UP_ENABLED ? `ON (range-follow trigger, cooldown=${GRID_TRAILING_UP_COOLDOWN_MS / MINUTE_MS}m)` : 'OFF'}
Trailing Down: ${GRID_TRAILING_DOWN_ENABLED ? `ON (range-follow trigger, cooldown=${GRID_TRAILING_DOWN_COOLDOWN_MS / MINUTE_MS}m)` : 'OFF'}
Max Active Orders: buy=${GRID_MAX_ACTIVE_BUY_ORDERS}, sell=${GRID_MAX_ACTIVE_SELL_ORDERS}
Recreate On Start: ${GRID_RECREATE_ON_START ? 'ON' : 'OFF'}
AI Validation: ${AI_VALIDATION_ENABLED ? `ON (${GEMINI_MODEL})` : 'OFF'}
Post Only (Maker): ${GRID_POST_ONLY ? 'ON' : 'OFF'}
Learning Memory: ${LEARNING_MEMORY_ENABLED ? 'ON' : 'OFF'}
`);
    await this.init();
    while (true) {
      await sleep(INTERVAL_MS);
      await this.executeCycle();
    }
  }
}

async function bootstrap() {
  validateRuntimeConfiguration();
  const lock = new ProcessLock(BOT_LOCK_PATH);
  lock.acquire();
  const shutdown = signal => {
    console.log(`[SHUTDOWN] ${signal}`);
    lock.release();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('exit', () => lock.release());

  try {
    const engine = new SpotGridEngine();
    await engine.start();
  } finally {
    lock.release();
  }
}

if (require.main === module) {
  bootstrap().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  AIGridValidator,
  Config,
  GridState,
  LearningMemory,
  ProcessLock,
  SpotGridEngine,
  bootstrap,
  validateRuntimeConfiguration,
};