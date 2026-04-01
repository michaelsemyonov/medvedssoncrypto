import { TradingRunner } from '@medvedsson/core';

import { buildTestConfig, generateCandles, silentLogger } from '../helpers.ts';
import { createFakeDatabase } from '../fake-db.ts';

describe('runner e2e flow', () => {
  it('creates a signal, fills the entry at next open, emits notifications, and stays idempotent across restart', async () => {
    const db = createFakeDatabase();
    await db.migrate();

    const config = buildTestConfig();
    const closes = [...Array.from({ length: 97 }, () => 100), 105, 106];
    const candles = generateCandles(closes);
    const notifications: Array<{
      symbol: string;
      signalType: string;
      approved: boolean;
    }> = [];

    const marketData = {
      fetchRecentCandles: async () => candles,
    };

    const notificationService = {
      notifySignal: async (event: {
        symbol: string;
        signalType: string;
        approved: boolean;
      }) => {
        notifications.push(event);
      },
      notifyRunnerError: async () => undefined,
    };

    const runner = new TradingRunner({
      config,
      db: db as never,
      marketData: marketData as never,
      notifications: notificationService as never,
      logger: silentLogger,
    });

    await runner.init();
    await runner.start();

    const run = await db.getActiveRun();
    const positions = run ? await db.getOpenPositions(run.id) : [];
    const signalsBeforeRestart = await db.getRecentSignals();

    expect(positions.length).toBe(1);
    expect(
      notifications.some(
        (item) => item.signalType === 'LONG_ENTRY' && item.approved
      )
    ).toBe(true);
    expect(
      signalsBeforeRestart.some((signal) => signal.signal_type === 'NO_SIGNAL')
    ).toBe(false);
    expect(
      signalsBeforeRestart.some((signal) => signal.signal_type === 'LONG_ENTRY')
    ).toBe(true);

    const secondRunner = new TradingRunner({
      config,
      db: db as never,
      marketData: marketData as never,
      notifications: notificationService as never,
      logger: silentLogger,
    });

    await secondRunner.init();
    await secondRunner.start();

    const signalsAfterRestart = await db.getRecentSignals();
    const entrySignals = signalsAfterRestart.filter(
      (signal) => signal.signal_type === 'LONG_ENTRY'
    );

    expect(entrySignals.length).toBe(1);

    await secondRunner.stop();
    await runner.stop();
    await db.close();
  });

  it('closes a primary position on stop loss and opens an approved counter position on the configured broker', async () => {
    const db = createFakeDatabase();
    await db.migrate();

    const config = buildTestConfig();
    const candles = generateCandles([
      ...Array.from({ length: 97 }, () => 100),
      105,
      106,
      100,
    ]);
    const notifications: Array<{
      symbol: string;
      signalType: string;
      approved: boolean;
    }> = [];

    const runner = new TradingRunner({
      config,
      db: db as never,
      marketData: {
        fetchRecentCandles: async () => candles,
      } as never,
      notifications: {
        notifySignal: async (event: {
          symbol: string;
          signalType: string;
          approved: boolean;
        }) => {
          notifications.push(event);
        },
        notifyRunnerError: async () => undefined,
      } as never,
      logger: silentLogger,
    });

    await runner.init();
    await runner.start();

    const run = await db.getActiveRun();
    const positions = run ? await db.getOpenPositions(run.id) : [];
    const signals = await db.getRecentSignals();

    expect(positions).toHaveLength(1);
    expect(positions[0]?.side).toBe('SHORT');
    expect(positions[0]?.broker).toBe('okx');
    expect(positions[0]?.is_counter_position).toBe(true);
    expect(
      signals.filter((signal) => signal.signal_type === 'LONG_EXIT')
    ).toHaveLength(1);
    expect(
      signals.filter((signal) => signal.signal_type === 'SHORT_ENTRY')
    ).toHaveLength(1);
    expect(
      notifications.some(
        (item) => item.signalType === 'LONG_EXIT' && item.approved
      )
    ).toBe(true);
    expect(
      notifications.some(
        (item) => item.signalType === 'SHORT_ENTRY' && item.approved
      )
    ).toBe(true);

    await runner.stop();
    await db.close();
  });

  it('uses the active symbol count when legacy rows still store max open positions as 5', async () => {
    const db = createFakeDatabase();
    await db.migrate();

    const config = buildTestConfig();
    const symbols = [
      'BTC/USDT',
      'ETH/USDT',
      'SOL/USDT',
      'XRP/USDT',
      'ADA/USDT',
      'DOGE/USDT',
    ];
    const closes = [...Array.from({ length: 97 }, () => 100), 105, 106];

    for (const symbol of symbols) {
      await db.createSymbol({
        ...config.defaultSymbolSettings,
        symbol,
        active: true,
        maxOpenPositions: 5,
      });
    }

    const runner = new TradingRunner({
      config,
      db: db as never,
      marketData: {
        fetchRecentCandles: async (symbol: string) =>
          generateCandles(closes, symbol),
      } as never,
      notifications: {
        notifySignal: async () => undefined,
        notifyRunnerError: async () => undefined,
      } as never,
      logger: silentLogger,
    });

    await runner.init();
    await runner.start();

    const run = await db.getActiveRun();
    const positions = run ? await db.getOpenPositions(run.id) : [];

    expect(positions).toHaveLength(symbols.length);

    await runner.stop();
    await db.close();
  });

  it('only fills a counter position on stop loss without opening a new reverse trade', async () => {
    const db = createFakeDatabase();
    await db.migrate();

    const config = buildTestConfig();
    const candles = generateCandles([
      ...Array.from({ length: 97 }, () => 100),
      105,
      106,
      100,
      104,
    ]);

    const runner = new TradingRunner({
      config,
      db: db as never,
      marketData: {
        fetchRecentCandles: async () => candles,
      } as never,
      notifications: {
        notifySignal: async () => undefined,
        notifyRunnerError: async () => undefined,
      } as never,
      logger: silentLogger,
    });

    await runner.init();
    await runner.start();

    const run = await db.getActiveRun();
    const positions = run ? await db.getOpenPositions(run.id) : [];
    const signals = await db.getRecentSignals();

    expect(positions).toHaveLength(0);
    expect(
      signals.filter((signal) => signal.signal_type === 'LONG_ENTRY')
    ).toHaveLength(1);
    expect(
      signals.filter((signal) => signal.signal_type === 'LONG_EXIT')
    ).toHaveLength(1);
    expect(
      signals.filter((signal) => signal.signal_type === 'SHORT_ENTRY')
    ).toHaveLength(1);
    expect(
      signals.filter((signal) => signal.signal_type === 'SHORT_EXIT')
    ).toHaveLength(1);

    await runner.stop();
    await db.close();
  });
});
