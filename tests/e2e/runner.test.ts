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
    const notifications: Array<{ symbol: string; signalType: string; approved: boolean }> = [];

    const marketData = {
      fetchRecentCandles: async () => candles
    };

    const notificationService = {
      notifySignal: async (event: { symbol: string; signalType: string; approved: boolean }) => {
        notifications.push(event);
      },
      notifyRunnerError: async () => undefined
    };

    const runner = new TradingRunner({
      config,
      db: db as never,
      marketData: marketData as never,
      notifications: notificationService as never,
      logger: silentLogger
    });

    await runner.init();
    await runner.start();

    const run = await db.getActiveRun();
    const positions = run ? await db.getOpenPositions(run.id) : [];
    const signalsBeforeRestart = await db.getRecentSignals();

    expect(positions.length).toBe(1);
    expect(notifications.some((item) => item.signalType === 'LONG_ENTRY' && item.approved)).toBe(true);
    expect(signalsBeforeRestart.some((signal) => signal.signal_type === 'LONG_ENTRY')).toBe(true);

    const secondRunner = new TradingRunner({
      config,
      db: db as never,
      marketData: marketData as never,
      notifications: notificationService as never,
      logger: silentLogger
    });

    await secondRunner.init();
    await secondRunner.start();

    const signalsAfterRestart = await db.getRecentSignals();
    const entrySignals = signalsAfterRestart.filter((signal) => signal.signal_type === 'LONG_ENTRY');

    expect(entrySignals.length).toBe(1);

    await secondRunner.stop();
    await runner.stop();
    await db.close();
  });
});
