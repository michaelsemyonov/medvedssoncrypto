import { buildTestConfig } from '../helpers.ts';
import { generateCandles } from '../helpers.ts';
import { createFakeDatabase } from '../fake-db.ts';

describe('database integration', () => {
  it('keeps signal inserts idempotent through the repository contract', async () => {
    const db = createFakeDatabase();
    const config = buildTestConfig();

    await db.migrate();
    const run = await db.startRun(config);
    const [symbol] = await db.replaceActiveSymbols(
      config.exchange,
      config.symbols
    );

    const first = await db.insertSignal({
      runId: run.id,
      symbolId: symbol!.id,
      exchange: config.exchange,
      symbol: symbol!.symbol,
      timeframe: config.timeframe,
      signal: {
        signalType: 'LONG_ENTRY',
        candleCloseTime: '2026-01-01T00:05:00.000Z',
        signalStrength: 1,
        formulaInputs: {
          r_t: 0.05,
          B_t: 0,
          N: 96,
          k: 5,
          H: 72,
          threshold: 0.04,
          comparison: 'LONG',
        },
        indicators: {
          return: 0.05,
          baselineMoveMagnitude: 0,
        },
        features: {},
        reason: 'Momentum breakout.',
      },
    });

    const second = await db.insertSignal({
      runId: run.id,
      symbolId: symbol!.id,
      exchange: config.exchange,
      symbol: symbol!.symbol,
      timeframe: config.timeframe,
      signal: {
        signalType: 'LONG_ENTRY',
        candleCloseTime: '2026-01-01T00:05:00.000Z',
        signalStrength: 1,
        formulaInputs: {
          r_t: 0.05,
          B_t: 0,
          N: 96,
          k: 5,
          H: 72,
          threshold: 0.04,
          comparison: 'LONG',
        },
        indicators: {
          return: 0.05,
          baselineMoveMagnitude: 0,
        },
        features: {},
        reason: 'Momentum breakout.',
      },
    });

    expect(first.id).toBe(second.id);
    expect((await db.getRecentSignals()).length).toBe(1);
    await db.close();
  });

  it('rejects NO_SIGNAL inserts and keeps the signals table clean', async () => {
    const db = createFakeDatabase();
    const config = buildTestConfig();

    await db.migrate();
    const run = await db.startRun(config);
    const [symbol] = await db.replaceActiveSymbols(
      config.exchange,
      config.symbols
    );

    await expect(
      db.insertSignal({
        runId: run.id,
        symbolId: symbol!.id,
        exchange: config.exchange,
        symbol: symbol!.symbol,
        timeframe: config.timeframe,
        signal: {
          signalType: 'NO_SIGNAL',
          candleCloseTime: '2026-01-01T00:05:00.000Z',
          signalStrength: null,
          formulaInputs: {
            r_t: 0,
            B_t: 0,
            N: 96,
            k: 5,
            H: 72,
            threshold: 0,
            comparison: 'NONE',
          },
          indicators: {
            return: 0,
            baselineMoveMagnitude: 0,
          },
          features: {},
          reason: 'No edge.',
        },
      })
    ).rejects.toThrow('NO_SIGNAL');

    expect((await db.getRecentSignals()).length).toBe(0);
    await db.close();
  });

  it('tracks processed candle progress independently from saved signals', async () => {
    const db = createFakeDatabase();
    const config = buildTestConfig();

    await db.migrate();
    const run = await db.startRun(config);
    const [symbol] = await db.replaceActiveSymbols(
      config.exchange,
      config.symbols
    );

    await db.recordProcessedCandle({
      runId: run.id,
      symbolId: symbol!.id,
      candleCloseTime: '2026-01-01T00:05:00.000Z',
    });

    expect(await db.getLastProcessedCloseTime(run.id, symbol!.id)).toBe(
      '2026-01-01T00:05:00.000Z'
    );
    expect((await db.getRecentSignals()).length).toBe(0);
    await db.close();
  });

  it('returns the latest 60 minutes of candles for each signal including the trigger candle', async () => {
    const db = createFakeDatabase();
    const config = buildTestConfig();

    await db.migrate();
    const run = await db.startRun(config);
    const [symbol] = await db.replaceActiveSymbols(
      config.exchange,
      config.symbols
    );

    await db.upsertCandles(
      generateCandles([
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113,
      ])
    );

    await db.insertSignal({
      runId: run.id,
      symbolId: symbol!.id,
      exchange: config.exchange,
      symbol: symbol!.symbol,
      timeframe: config.timeframe,
      signal: {
        signalType: 'LONG_ENTRY',
        candleCloseTime: '2026-01-01T01:10:00.000Z',
        signalStrength: 1,
        formulaInputs: {
          r_t: 0.05,
          B_t: 0,
          N: 96,
          k: 5,
          H: 72,
          threshold: 0.04,
          comparison: 'LONG',
        },
        indicators: {
          return: 0.05,
          baselineMoveMagnitude: 0,
        },
        features: {},
        reason: 'Momentum breakout.',
      },
    });

    const [signal] = await db.getRecentSignalsWithCandles(100, 0, 12);

    expect(signal?.recent_candles).toHaveLength(12);
    expect(signal?.recent_candles[0]?.closeTime).toBe(
      '2026-01-01T00:15:00.000Z'
    );
    expect(signal?.recent_candles.at(-1)?.closeTime).toBe(
      '2026-01-01T01:10:00.000Z'
    );

    await db.close();
  });

  it('returns recent trades in descending order by entry time', async () => {
    vi.useFakeTimers();

    const db = createFakeDatabase();
    const config = buildTestConfig();

    try {
      await db.migrate();
      const run = await db.startRun(config);
      const [btc, eth] = await db.replaceActiveSymbols(config.exchange, [
        'BTC/USDT',
        'ETH/USDT',
      ]);

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const btcOpenOrder = await db.createPendingOrder({
        runId: run.id,
        signalId: 'btc-open',
        symbolId: btc!.id,
        orderType: 'MARKET',
        side: 'BUY',
        intent: 'OPEN_POSITION',
        referencePrice: 100,
        qty: 1,
        notionalUsdt: 100,
        slippageBps: 0,
        feeRate: 0.001,
        feeAmount: 0.1,
        fillModel: 'next_open',
        meta: {},
      });
      await db.fillPendingOrder(
        btcOpenOrder!.id,
        100,
        '2026-01-01T00:05:00.000Z'
      );

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      const ethOpenOrder = await db.createPendingOrder({
        runId: run.id,
        signalId: 'eth-open',
        symbolId: eth!.id,
        orderType: 'MARKET',
        side: 'BUY',
        intent: 'OPEN_POSITION',
        referencePrice: 200,
        qty: 1,
        notionalUsdt: 200,
        slippageBps: 0,
        feeRate: 0.001,
        feeAmount: 0.2,
        fillModel: 'next_open',
        meta: {},
      });
      await db.fillPendingOrder(
        ethOpenOrder!.id,
        200,
        '2026-01-01T00:10:00.000Z'
      );

      const openPositions = await db.getOpenPositions(run.id);
      const btcPosition = openPositions.find(
        (position) => position.symbol === 'BTC/USDT'
      );
      const ethPosition = openPositions.find(
        (position) => position.symbol === 'ETH/USDT'
      );

      vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
      const btcCloseOrder = await db.createPendingOrder({
        runId: run.id,
        signalId: 'btc-close',
        symbolId: btc!.id,
        orderType: 'MARKET',
        side: 'SELL',
        intent: 'CLOSE_POSITION',
        referencePrice: 101,
        qty: 1,
        notionalUsdt: 101,
        slippageBps: 0,
        feeRate: 0.001,
        feeAmount: 0.101,
        fillModel: 'next_open',
        positionId: btcPosition!.id,
        meta: {
          position_id: btcPosition!.id,
        },
      });
      await db.fillPendingOrder(
        btcCloseOrder!.id,
        101,
        '2026-01-02T00:05:00.000Z'
      );

      vi.setSystemTime(new Date('2026-01-02T00:00:01.000Z'));
      const ethCloseOrder = await db.createPendingOrder({
        runId: run.id,
        signalId: 'eth-close',
        symbolId: eth!.id,
        orderType: 'MARKET',
        side: 'SELL',
        intent: 'CLOSE_POSITION',
        referencePrice: 202,
        qty: 1,
        notionalUsdt: 202,
        slippageBps: 0,
        feeRate: 0.001,
        feeAmount: 0.202,
        fillModel: 'next_open',
        positionId: ethPosition!.id,
        meta: {
          position_id: ethPosition!.id,
        },
      });
      await db.fillPendingOrder(
        ethCloseOrder!.id,
        202,
        '2026-01-02T00:04:00.000Z'
      );

      const trades = await db.getRecentTrades();

      expect(trades.map((trade) => trade.symbol).slice(0, 2)).toEqual([
        'ETH/USDT',
        'BTC/USDT',
      ]);
    } finally {
      await db.close();
      vi.useRealTimers();
    }
  });

  it('uses the opening signal time when a stored trade entry predates its signal', async () => {
    const db = createFakeDatabase();
    const config = buildTestConfig();

    await db.migrate();
    const run = await db.startRun(config);
    const [symbol] = await db.replaceActiveSymbols(
      config.exchange,
      config.symbols
    );

    const signal = await db.insertSignal({
      runId: run.id,
      symbolId: symbol!.id,
      exchange: config.exchange,
      symbol: symbol!.symbol,
      timeframe: config.timeframe,
      signal: {
        signalType: 'LONG_ENTRY',
        candleCloseTime: '2026-01-01T00:10:00.000Z',
        signalStrength: 1,
        formulaInputs: {
          r_t: 0.05,
          B_t: 0,
          N: 96,
          k: 5,
          H: 72,
          threshold: 0.04,
          comparison: 'LONG',
        },
        indicators: {
          return: 0.05,
          baselineMoveMagnitude: 0,
        },
        features: {},
        reason: 'Momentum breakout.',
      },
    });

    const openOrder = await db.createPendingOrder({
      runId: run.id,
      signalId: signal.id,
      symbolId: symbol!.id,
      orderType: 'MARKET',
      side: 'BUY',
      intent: 'OPEN_POSITION',
      referencePrice: 100,
      qty: 1,
      notionalUsdt: 100,
      slippageBps: 0,
      feeRate: 0.001,
      feeAmount: 0.1,
      fillModel: 'next_open',
      meta: {},
    });
    await db.fillPendingOrder(openOrder!.id, 100, '2026-01-01T00:05:00.000Z');

    const [openPosition] = await db.getOpenPositions(run.id);
    const closeOrder = await db.createPendingOrder({
      runId: run.id,
      signalId: 'close-signal',
      symbolId: symbol!.id,
      orderType: 'MARKET',
      side: 'SELL',
      intent: 'CLOSE_POSITION',
      referencePrice: 101,
      qty: 1,
      notionalUsdt: 101,
      slippageBps: 0,
      feeRate: 0.001,
      feeAmount: 0.101,
      fillModel: 'next_open',
      positionId: openPosition!.id,
      meta: {
        position_id: openPosition!.id,
      },
    });
    await db.fillPendingOrder(closeOrder!.id, 101, '2026-01-01T00:15:00.000Z');

    const [trade] = await db.getRecentTrades();

    expect(trade?.entry_time.toISOString()).toBe('2026-01-01T00:05:00.000Z');
    expect(trade?.opened_at.toISOString()).toBe('2026-01-01T00:10:00.000Z');

    await db.close();
  });
});
