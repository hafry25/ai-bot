const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GRID_MODE = 'ARITHMETIC';
process.env.GRID_COUNT = '10';

const { SpotGridEngine } = require('../index');

test('sell placement uses only inventory tracked from prior grid buys', () => {
  const engine = Object.create(SpotGridEngine.prototype);
  engine.state = {
    getSymbol: () => ({
      lastBuyByLevel: {
        4: { amount: 100, sellableAmount: 99.9 },
      },
    }),
  };

  assert.equal(engine.amountForTrackedSell('BONK/USDT', 5), 99.9);
  assert.equal(engine.amountForTrackedSell('BONK/USDT', 6), 0);
});

test('tracked sell amount falls back to buy amount for legacy state', () => {
  const engine = Object.create(SpotGridEngine.prototype);
  engine.state = {
    getSymbol: () => ({
      lastBuyByLevel: {
        2: { amount: 42 },
      },
    }),
  };

  assert.equal(engine.amountForTrackedSell('BONK/USDT', 3), 42);
});

test('placeLimit skips invalid dust amounts and clears pending level', async () => {
  const engine = Object.create(SpotGridEngine.prototype);
  engine.pendingOrderLevels = new Set();
  engine.makeClientOrderId = () => 'grid-bonk-s-5-test';
  engine.exchange = {
    priceToPrecision: () => '0.000005',
    amountToPrecision: () => {
      const err = new Error('binance amount of BONK/USDT must be greater than minimum amount precision of 1');
      err.name = 'InvalidOrder';
      throw err;
    },
    createLimitOrder: () => {
      throw new Error('should not create order');
    },
  };

  const order = await engine.placeLimit('BONK/USDT', 'sell', 5, 0.000005, 0.25);

  assert.equal(order, null);
  assert.equal(engine.pendingOrderLevels.size, 0);
});

test('handleSellFill guards zero sellable buy records', async () => {
  const symState = {
    orders: {
      sellOrder: { levelIndex: 5 },
    },
    lastBuyByLevel: {
      4: {
        amount: 0,
        sellableAmount: 0,
        totalCostQuote: 0,
        totalFeeQuote: 0,
      },
    },
    realizedGridProfit: 0,
  };
  let saved = 0;
  let processedTradeId = null;
  const engine = Object.create(SpotGridEngine.prototype);
  engine.state = {
    data: {
      totals: {
        realizedGridProfit: 0,
        filledSells: 0,
      },
    },
    markProcessedTrade: (_symbol, id) => {
      processedTradeId = id;
    },
    save: () => {
      saved++;
    },
  };

  await engine.handleSellFill(
    'BONK/USDT',
    [],
    {},
    symState,
    { id: 'trade-1', order: 'sellOrder', price: 10, amount: 1, fee: { cost: 0, currency: 'USDT' } },
    { levelIndex: 5 },
    new Set()
  );

  assert.equal(processedTradeId, 'trade-1');
  assert.equal(symState.realizedGridProfit, 0);
  assert.equal(engine.state.data.totals.filledSells, 0);
  assert.equal(symState.orders.sellOrder, undefined);
  assert.equal(symState.lastBuyByLevel[4].sellableAmount, 0);
  assert.equal(saved, 1);
});
