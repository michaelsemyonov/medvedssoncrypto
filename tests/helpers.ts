import type { AppConfig, Candle } from '@medvedsson/shared';

export const buildTestConfig = (): AppConfig => ({
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: 'mysql://root:root@localhost:3306/test',
  exchange: 'bybit',
  exchangeTimeoutMs: 1000,
  exchangeRateLimitMs: 0,
  timeframe: '5m',
  symbols: ['BTC/USDT'],
  dryRun: true,
  allowShort: true,
  strategyKey: 'momentum_96_5_72',
  strategyVersion: '1.0.0-test',
  signal: {
    n: 96,
    k: 5,
    hBars: 72,
    timeframe: '5m'
  },
  execution: {
    fillModel: 'next_open',
    positionSizingMode: 'fixed_usdt',
    feeRate: 0.001,
    slippageBps: 5,
    fixedUsdtPerTrade: 100,
    equityStartUsdt: 10000
  },
  maxOpenPositions: 5,
  cooldownBars: 3,
  maxDailyDrawdownPct: 5,
  maxConsecutiveLosses: 5,
  pollIntervalMs: 60_000,
  enableCandleStorage: true,
  runnerAutostart: false,
  logLevel: 'error',
  auth: {
    adminPassword: 'test-password',
    sessionSecret: 'test-session-secret-should-be-at-least-32-bytes',
    sessionTtlHours: 168
  },
  webPushVapidPublicKey: '',
  webPushVapidPrivateKey: '',
  webPushContact: 'mailto:test@example.com'
});

export const generateCandles = (closes: number[], symbol = 'BTC/USDT'): Candle[] => {
  const baseOpenTime = new Date('2026-01-01T00:00:00.000Z').getTime();

  return closes.map((close, index) => {
    const openTime = new Date(baseOpenTime + index * 5 * 60 * 1000);
    const closeTime = new Date(openTime.getTime() + 5 * 60 * 1000);
    const previousClose = closes[index - 1] ?? close;

    return {
      exchange: 'bybit',
      symbol,
      timeframe: '5m',
      openTime: openTime.toISOString(),
      closeTime: closeTime.toISOString(),
      open: previousClose,
      high: Math.max(previousClose, close),
      low: Math.min(previousClose, close),
      close,
      volume: 10,
      source: 'test'
    };
  });
};

export const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
};
