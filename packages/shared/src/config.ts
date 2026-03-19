import { z } from 'zod';

import type { AppConfig } from './types.ts';
import { normalizeSymbol, parseSymbols } from './utils.ts';

const booleanish = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}, z.boolean());

const numberish = z.preprocess((value) => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  return Number(value);
}, z.number());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: numberish.default(3000),
  DATABASE_URL: z.string().min(1),
  EXCHANGE: z.enum(['bybit', 'binance']).default('bybit'),
  EXCHANGE_TIMEOUT_MS: numberish.default(10000),
  EXCHANGE_RATE_LIMIT_MS: numberish.default(300),
  TIMEFRAME: z.literal('5m').default('5m'),
  SYMBOLS: z.string().default('BTC/USDT,ETH/USDT,SOL/USDT'),
  DRY_RUN: booleanish.default(true),
  ALLOW_SHORT: booleanish.default(true),
  STRATEGY_KEY: z.string().default('momentum_96_5_72'),
  STRATEGY_VERSION: z.string().default('1.0.0'),
  SIGNAL_N: numberish.default(96),
  SIGNAL_K: numberish.default(5),
  SIGNAL_H_BARS: numberish.default(72),
  FILL_MODEL: z.literal('next_open').default('next_open'),
  FEE_RATE: numberish.default(0.001),
  SLIPPAGE_BPS: numberish.default(5),
  FIXED_USDT_PER_TRADE: numberish.default(100),
  EQUITY_START_USDT: numberish.default(10000),
  MAX_OPEN_POSITIONS: numberish.default(5),
  COOLDOWN_BARS: numberish.default(3),
  MAX_DAILY_DRAWDOWN_PCT: numberish.default(5),
  MAX_CONSECUTIVE_LOSSES: numberish.default(5),
  POLL_INTERVAL_MS: numberish.default(15000),
  ENABLE_CANDLE_STORAGE: booleanish.default(true),
  RUNNER_AUTOSTART: booleanish.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ADMIN_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: numberish.default(168),
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().default(''),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().default(''),
  WEB_PUSH_CONTACT: z.string().default('mailto:you@example.com')
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.parse(env);

  if (!parsed.DRY_RUN) {
    throw new Error('V1 hard-enforces DRY_RUN=true. Refusing to boot with live execution enabled.');
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    exchange: parsed.EXCHANGE,
    exchangeTimeoutMs: parsed.EXCHANGE_TIMEOUT_MS,
    exchangeRateLimitMs: parsed.EXCHANGE_RATE_LIMIT_MS,
    timeframe: parsed.TIMEFRAME,
    symbols: parseSymbols(parsed.SYMBOLS).map(normalizeSymbol),
    dryRun: true,
    allowShort: parsed.ALLOW_SHORT,
    strategyKey: parsed.STRATEGY_KEY,
    strategyVersion: parsed.STRATEGY_VERSION,
    signal: {
      n: parsed.SIGNAL_N,
      k: parsed.SIGNAL_K,
      hBars: parsed.SIGNAL_H_BARS,
      timeframe: parsed.TIMEFRAME
    },
    execution: {
      fillModel: parsed.FILL_MODEL,
      feeRate: parsed.FEE_RATE,
      slippageBps: parsed.SLIPPAGE_BPS,
      fixedUsdtPerTrade: parsed.FIXED_USDT_PER_TRADE,
      equityStartUsdt: parsed.EQUITY_START_USDT
    },
    maxOpenPositions: parsed.MAX_OPEN_POSITIONS,
    cooldownBars: parsed.COOLDOWN_BARS,
    maxDailyDrawdownPct: parsed.MAX_DAILY_DRAWDOWN_PCT,
    maxConsecutiveLosses: parsed.MAX_CONSECUTIVE_LOSSES,
    pollIntervalMs: parsed.POLL_INTERVAL_MS,
    enableCandleStorage: parsed.ENABLE_CANDLE_STORAGE,
    runnerAutostart: parsed.RUNNER_AUTOSTART,
    logLevel: parsed.LOG_LEVEL,
    auth: {
      adminPassword: parsed.ADMIN_PASSWORD,
      sessionSecret: parsed.SESSION_SECRET,
      sessionTtlHours: parsed.SESSION_TTL_HOURS
    },
    webPushVapidPublicKey: parsed.WEB_PUSH_VAPID_PUBLIC_KEY,
    webPushVapidPrivateKey: parsed.WEB_PUSH_VAPID_PRIVATE_KEY,
    webPushContact: parsed.WEB_PUSH_CONTACT
  };
};
