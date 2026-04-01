import { z } from 'zod';

import type { AppConfig, SymbolRuntimeSettings } from './types.ts';
import { normalizeSymbol } from './utils.ts';

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

export const DEFAULT_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'] as const;

export const DEFAULT_SYMBOL_SETTINGS: SymbolRuntimeSettings = {
  exchange: 'bybit',
  exchangeTimeoutMs: 10000,
  exchangeRateLimitMs: 300,
  timeframe: '5m',
  dryRun: true,
  allowShort: true,
  strategyKey: 'momentum_96_5_72',
  strategyVersion: '1.0.0',
  signal: {
    n: 96,
    k: 5,
    hBars: 72,
    timeframe: '5m',
  },
  execution: {
    fillModel: 'next_open',
    positionSizingMode: 'fixed_usdt',
    feeRate: 0.001,
    slippageBps: 5,
    fixedUsdtPerTrade: 100,
    equityStartUsdt: 10000,
  },
  maxOpenPositions: 5,
  cooldownBars: 3,
  maxDailyDrawdownPct: 5,
  maxConsecutiveLosses: 5,
  pollIntervalMs: 15000,
};

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: numberish.default(3000),
  DATABASE_URL: z.string().min(1),
  ENABLE_CANDLE_STORAGE: booleanish.default(true),
  RUNNER_AUTOSTART: booleanish.default(true),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  ADMIN_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: numberish.default(168),
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().default(''),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().default(''),
  WEB_PUSH_CONTACT: z.string().default('mailto:you@example.com'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.parse(env);
  const defaultSymbols = DEFAULT_SYMBOLS.map(normalizeSymbol);
  const defaultSettings = DEFAULT_SYMBOL_SETTINGS;

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    exchange: defaultSettings.exchange,
    exchangeTimeoutMs: defaultSettings.exchangeTimeoutMs,
    exchangeRateLimitMs: defaultSettings.exchangeRateLimitMs,
    timeframe: defaultSettings.timeframe,
    symbols: defaultSymbols,
    dryRun: defaultSettings.dryRun,
    allowShort: defaultSettings.allowShort,
    strategyKey: defaultSettings.strategyKey,
    strategyVersion: defaultSettings.strategyVersion,
    signal: defaultSettings.signal,
    execution: defaultSettings.execution,
    maxOpenPositions: defaultSettings.maxOpenPositions,
    cooldownBars: defaultSettings.cooldownBars,
    maxDailyDrawdownPct: defaultSettings.maxDailyDrawdownPct,
    maxConsecutiveLosses: defaultSettings.maxConsecutiveLosses,
    pollIntervalMs: defaultSettings.pollIntervalMs,
    defaultSymbols,
    defaultSymbolSettings: defaultSettings,
    enableCandleStorage: parsed.ENABLE_CANDLE_STORAGE,
    runnerAutostart: parsed.RUNNER_AUTOSTART,
    logLevel: parsed.LOG_LEVEL,
    auth: {
      adminPassword: parsed.ADMIN_PASSWORD,
      sessionSecret: parsed.SESSION_SECRET,
      sessionTtlHours: parsed.SESSION_TTL_HOURS,
    },
    webPushVapidPublicKey: parsed.WEB_PUSH_VAPID_PUBLIC_KEY,
    webPushVapidPrivateKey: parsed.WEB_PUSH_VAPID_PRIVATE_KEY,
    webPushContact: parsed.WEB_PUSH_CONTACT,
  };
};
