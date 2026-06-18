const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_VALIDATION_ENABLED = 'true';
process.env.AI_VALIDATION_MIN_INTERVAL_MS = '60000';
process.env.AI_VALIDATION_CACHE_TTL_MS = '60000';
process.env.GEMINI_API_KEY = 'test-key';

const { AIGridValidator, LearningMemory } = require('../index');

test('AI validation reuses the last decision during the minimum interval', async () => {
  AIGridValidator.lastDecisionBySymbol.clear();
  AIGridValidator.cache.clear();
  AIGridValidator.rateLimitedUntil = 0;

  let ohlcvCalls = 0;
  let modelCalls = 0;
  const validator = Object.create(AIGridValidator.prototype);
  validator.exchange = {
    fetchOHLCV: async () => {
      ohlcvCalls++;
      return [
        [1, 100, 101, 99, 100, 10],
        [2, 100, 102, 99, 101, 10],
      ];
    },
  };
  validator.model = {
    generateContent: async () => {
      modelCalls++;
      return {
        response: {
          text: () => JSON.stringify({
            allowTrading: true,
            allowBuy: true,
            allowSell: true,
            confidence: 90,
            reason: 'ok',
          }),
        },
      };
    },
  };
  validator.learningMemory = null;
  validator.getCached = () => null;
  validator.setCached = () => {};

  const context = {
    currentPrice: 100,
    lower: 90,
    upper: 110,
    levels: [90, 100, 110],
  };

  const first = await validator.validate('BTC/USDT', context);
  const second = await validator.validate('BTC/USDT', context);

  assert.equal(first.allowTrading, true);
  assert.equal(second, first);
  assert.equal(ohlcvCalls, 1);
  assert.equal(modelCalls, 1);
});

test('AI validation refreshes cache after learning memory adjusts confidence', async () => {
  AIGridValidator.lastDecisionBySymbol.clear();
  AIGridValidator.cache.clear();
  AIGridValidator.rateLimitedUntil = 0;

  const cachedValues = [];
  const validator = Object.create(AIGridValidator.prototype);
  validator.exchange = {
    fetchOHLCV: async () => [
      [1, 100, 101, 99, 100, 10],
      [2, 100, 102, 99, 101, 10],
    ],
  };
  validator.model = {
    generateContent: async () => ({
      response: {
        text: () => JSON.stringify({
          allowTrading: true,
          allowBuy: true,
          allowSell: true,
          confidence: 80,
          reason: 'ok',
        }),
      },
    }),
  };
  validator.getCached = () => null;
  validator.setCached = (_key, value) => {
    cachedValues.push({ ...value });
  };
  validator.learningMemory = {
    enrichContext: () => ({ currentPrice: 100 }),
    querySimilarWithFeatures: () => ({
      samples: 5,
      weightedRatio: 1,
      ratio: 1,
      weightedSamples: 5,
      closestDistance: 0,
    }),
    recordDecision: () => {},
  };

  const context = {
    currentPrice: 100,
    lower: 90,
    upper: 110,
    levels: [90, 100, 110],
  };

  const decision = await validator.validate('BTC/USDT', context);
  const remembered = AIGridValidator.lastDecisionBySymbol.get('BTC/USDT').value;

  assert.equal(cachedValues.length, 2);
  assert.equal(cachedValues.at(-1).confidence, 92);
  assert.equal(decision.confidence, 92);
  assert.equal(remembered.confidence, 92);
  assert.match(decision.reason, /Memory: 100% weighted success/);
});

test('LearningMemory weighting favors recent outcomes', () => {
  const memory = Object.create(LearningMemory.prototype);
  memory.enabled = true;
  memory.records = [];

  const now = Date.now();
  const features = {
    symbol: 'BTC/USDT',
    currentPrice: 100,
    rangePct: 5,
    distLower: 2,
    distUpper: 3,
    positionPct: 40,
    trailingUp: 0,
    trailingDown: 0,
    changePct: 1,
    volumeRatio: 1,
  };

  memory.records.push(
    {
      symbol: 'BTC/USDT',
      timestamp: now - 48 * 60 * 60 * 1000,
      context: { ...features },
      outcome: 'success',
    },
    {
      symbol: 'BTC/USDT',
      timestamp: now - 5 * 60 * 60 * 1000,
      context: { ...features },
      outcome: 'failure',
    },
    {
      symbol: 'BTC/USDT',
      timestamp: now - 5 * 60 * 60 * 1000,
      context: { ...features },
      outcome: 'failure',
    },
    {
      symbol: 'BTC/USDT',
      timestamp: now - 5 * 60 * 60 * 1000,
      context: { ...features },
      outcome: 'failure',
    },
    {
      symbol: 'BTC/USDT',
      timestamp: now - 5 * 60 * 60 * 1000,
      context: { ...features },
      outcome: 'failure',
    }
  );

  const result = memory.querySimilarWithFeatures(features);

  assert.ok(result);
  assert.equal(result.samples, 5);
  assert.ok(result.ratio > result.weightedRatio);
  assert.equal(typeof result.closestDistance, 'number');
});

test('AI validation cache evicts least recently used non-expired entry', () => {
  AIGridValidator.cache.clear();
  AIGridValidator.MAX_CACHE_SIZE = 2;
  const validator = Object.create(AIGridValidator.prototype);

  validator.setCached('old', { reason: 'old' });
  validator.setCached('recent', { reason: 'recent' });
  assert.equal(validator.getCached('old').reason, 'old');
  validator.setCached('new', { reason: 'new' });

  assert.equal(validator.getCached('recent'), null);
  assert.equal(validator.getCached('old').reason, 'old');
  assert.equal(validator.getCached('new').reason, 'new');

  AIGridValidator.cache.clear();
  AIGridValidator.MAX_CACHE_SIZE = 100;
});
