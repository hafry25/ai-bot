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

test('handleBuyFill skips refill sell when sell level is already active', async () => {
  const symState = {
    orders: {
      buyOrder: { side: 'buy', levelIndex: 4 },
      sellOrder: { side: 'sell', levelIndex: 5 },
    },
    lastBuyByLevel: {},
  };
  let placed = false;
  const engine = Object.create(SpotGridEngine.prototype);
  engine.exchange = {
    markets: {
      'BONK/USDT': { limits: { cost: { min: 0 } } },
    },
    priceToPrecision: (_symbol, price) => String(price),
    amountToPrecision: (_symbol, amount) => String(amount),
  };
  engine.state = {
    data: {
      totals: {
        filledBuys: 0,
      },
    },
    save: () => {},
    markProcessedTrade: () => {},
  };
  engine.sendAlert = async () => {};
  engine.placeLimit = async () => {
    placed = true;
  };

  await engine.handleBuyFill(
    'BONK/USDT',
    [1, 2, 3, 4, 5, 6],
    { allowTrading: true, allowSell: true },
    symState,
    { id: 'trade-1', order: 'buyOrder', price: 4, amount: 10, datetime: '2026-01-01T00:00:00.000Z', fee: { cost: 0, currency: 'USDT' } },
    { levelIndex: 4 },
    new Set(['sellOrder'])
  );

  assert.equal(placed, false);
  assert.equal(symState.orders.buyOrder, undefined);
  assert.equal(symState.orders.sellOrder.levelIndex, 5);
  assert.equal(symState.lastBuyByLevel[4].sellableAmount, 10);
});
