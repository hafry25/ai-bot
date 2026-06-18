const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GRID_MODE = 'ARITHMETIC';
process.env.GRID_COUNT = '10';
process.env.GRID_RANGE_PCT = '5';
process.env.GRID_RESET_RANGE_ON_START = 'true';
process.env.GRID_TOTAL_INVESTMENT_USDT = '100';

const { SpotGridEngine } = require('../index');

test('auto range reset happens only once per symbol at startup', () => {
  const symbolState = {
    config: { lower: 80, upper: 120 },
    orders: {},
    lastBuyByLevel: {},
  };
  const engine = Object.create(SpotGridEngine.prototype);
  engine.rangeResetSymbols = new Set();
  engine.state = {
    getSymbol: () => symbolState,
    save: () => {},
  };

  assert.deepEqual(engine.buildRange('BTC/USDT', 100), { lower: 95, upper: 105 });
  assert.deepEqual(engine.buildRange('BTC/USDT', 110), { lower: 95, upper: 105 });
});

test('amountForBuy respects remaining total investment cap', () => {
  const symbolState = {
    orders: {
      openBuy: { side: 'buy', amount: 2, price: 10 },
      openSell: { side: 'sell', amount: 1, price: 30 },
    },
    lastBuyByLevel: {
      1: { totalCostQuote: 70 },
    },
  };
  const engine = Object.create(SpotGridEngine.prototype);
  engine.exchange = {
    markets: {
      'BTC/USDT': { limits: { cost: { min: 5 } } },
    },
  };
  engine.state = {
    getSymbol: () => symbolState,
  };

  assert.equal(engine.getAllocatedInvestmentUsdt('BTC/USDT'), 90);
  assert.equal(engine.getRemainingInvestmentUsdt('BTC/USDT'), 10);
  assert.equal(engine.amountForBuy('BTC/USDT', 10), 1);

  symbolState.lastBuyByLevel[2] = { totalCostQuote: 10 };
  assert.equal(engine.getRemainingInvestmentUsdt('BTC/USDT'), 0);
  assert.equal(engine.amountForBuy('BTC/USDT', 10), 0);
});
