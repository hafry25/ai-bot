const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GRID_MODE = 'ARITHMETIC';
process.env.GRID_COUNT = '10';
process.env.GRID_TRAILING_UP_ENABLED = 'true';

const { AIGridValidator, SpotGridEngine } = require('../index');

test('trailing-up trigger is one arithmetic grid above upper bound', () => {
  const engine = Object.create(SpotGridEngine.prototype);

  assert.equal(engine.getTrailingUpTrigger(90, 110), 112);
});

test('trailing-up shifts stored order and buy-lot indexes together', () => {
  const symbolState = {
    orders: {
      buy: { levelIndex: 0 },
      sell: { levelIndex: 8 },
    },
    lastBuyByLevel: {
      0: { amount: 1 },
      4: { amount: 2 },
    },
  };
  const engine = Object.create(SpotGridEngine.prototype);
  engine.state = {
    getSymbol: () => symbolState,
  };

  engine.shiftStoredLevelIndexes('BTC/USDT', -1);

  assert.equal(symbolState.orders.buy.levelIndex, -1);
  assert.equal(symbolState.orders.sell.levelIndex, 7);
  assert.deepEqual(Object.keys(symbolState.lastBuyByLevel).sort(), ['-1', '3']);
});

test('AI prompt treats a completed trailing-up shift as expected', () => {
  const validator = Object.create(AIGridValidator.prototype);
  const prompt = validator.buildPrompt('BTC/USDT', {
    currentPrice: 112,
    lower: 92,
    upper: 112,
    levels: [92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112],
    trailingUpJustShifted: true,
  }, {});

  assert.match(prompt, /Trailing Up Just Shifted: true/);
  assert.match(prompt, /Do not block solely because price is near the new upper bound/);
});

test('trailing-up follows a large move by shifting multiple grids', async () => {
  const symbolState = {
    config: { lower: 90, upper: 110 },
    orders: {
      buy: { levelIndex: 2 },
    },
    lastBuyByLevel: {
      4: { amount: 2 },
    },
  };
  const engine = Object.create(SpotGridEngine.prototype);
  engine.state = {
    getSymbol: () => symbolState,
    save: () => {},
  };
  engine.sendAlert = async () => {};

  const shifted = await engine.maybeTrailUpRange('BTC/USDT', 116, 90, 110);

  assert.deepEqual(shifted, { lower: 96, upper: 116 });
  assert.equal(symbolState.config.lower, 96);
  assert.equal(symbolState.config.upper, 116);
  assert.equal(symbolState.orders.buy.levelIndex, -1);
  assert.deepEqual(Object.keys(symbolState.lastBuyByLevel), ['1']);
  assert.equal(symbolState.trailingUp.shifts, 3);
});

test('trailing-up keeps below-range buy lots on exit level', async () => {
  const symbolState = {
    config: { lower: 90, upper: 110 },
    orders: {},
    lastBuyByLevel: {
      0: {
        price: 90,
        amount: 1,
        sellableAmount: 0.99,
        totalCostQuote: 90,
        totalFeeQuote: 0.1,
        at: '2026-01-01T00:00:00.000Z',
      },
    },
    trailingUp: { shifts: 0, lastShiftAt: null },
  };
  const engine = Object.create(SpotGridEngine.prototype);
  engine.state = {
    getSymbol: () => symbolState,
    save: () => {},
  };
  engine.cancelGridOrders = async () => ({ cancelled: [], failed: [] });
  engine.sendAlert = async () => {};

  await engine.applyTrailingRangeShift('BTC/USDT', 90, 110, { lower: 92, upper: 112, steps: 1 }, 'up');

  assert.deepEqual(Object.keys(symbolState.lastBuyByLevel), ['-1']);
  assert.equal(symbolState.lastBuyByLevel[-1].sellableAmount, 0.99);
  assert.equal(engine.amountForTrackedSell('BTC/USDT', 0), 0.99);
});

test('trailing-up aborts state shift when order cancellation fails', async () => {
  const symbolState = {
    config: { lower: 90, upper: 110 },
    orders: {
      buy: { levelIndex: 2 },
    },
    lastBuyByLevel: {
      4: { amount: 2 },
    },
    trailingUp: { shifts: 0, lastShiftAt: null },
  };
  const engine = Object.create(SpotGridEngine.prototype);
  engine.state = {
    getSymbol: () => symbolState,
    save: () => {
      throw new Error('state must not be saved');
    },
  };
  engine.cancelGridOrders = async () => ({
    cancelled: [],
    failed: [{ id: 'order-1', error: new Error('network') }],
  });
  engine.sendAlert = async () => {
    throw new Error('alert must not be sent');
  };

  await assert.rejects(
    () => engine.applyTrailingRangeShift('BTC/USDT', 90, 110, { lower: 92, upper: 112, steps: 1 }, 'up'),
    /failed to cancel grid orders: order-1/
  );

  assert.equal(symbolState.config.lower, 90);
  assert.equal(symbolState.config.upper, 110);
  assert.equal(symbolState.orders.buy.levelIndex, 2);
  assert.deepEqual(Object.keys(symbolState.lastBuyByLevel), ['4']);
  assert.equal(symbolState.trailingUp.shifts, 0);
});
