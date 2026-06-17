const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_VALIDATION_ENABLED = 'true';
process.env.AI_VALIDATION_MIN_INTERVAL_MS = '60000';
process.env.AI_VALIDATION_CACHE_TTL_MS = '60000';
process.env.GEMINI_API_KEY = 'test-key';

const { AIGridValidator } = require('../index');

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
