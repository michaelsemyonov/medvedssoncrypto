import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { notificationFailuresCounter, TradingRunner } from '@medvedsson/core';
import { createDatabase } from '@medvedsson/db';
import { MarketDataAdapter } from '@medvedsson/market-data';
import { NotificationService } from '@medvedsson/notifications';
import {
  getDayBoundsInTimeZone,
  getBearerToken,
  loadConfig,
  normalizeSymbol,
  parseCookieHeader,
  resolveMaxOpenPositions,
  SESSION_COOKIE_NAME,
  type ExchangeName,
  type Timeframe,
  type PushSubscriptionRecord,
  verifySessionToken,
} from '@medvedsson/shared';
import Fastify from 'fastify';
import pino from 'pino';
import { z } from 'zod';

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const SIGNAL_CHART_CANDLE_COUNT = 12;
const POSITION_CHART_CANDLE_COUNT = 24;
const POSITION_CHART_TIMEFRAME: Timeframe = '15m';
const DASHBOARD_TIME_ZONE = 'Europe/Stockholm';
const marketDataExchangeSchema = z.enum(['bybit', 'binance', 'okx']);
const brokerSchema = z.enum(['bybit', 'okx']);

const symbolUpdateSchema = z.object({
  exchange: marketDataExchangeSchema.default('bybit'),
  symbols: z.array(z.string().min(1)).default([]),
});

const trailingProfileSchema = z.enum([
  'conservative',
  'balanced',
  'aggressive',
  'custom',
]);

const symbolSettingsSchema = z.object({
  symbol: z.string().min(1),
  active: z.boolean().default(true),
  exchange: marketDataExchangeSchema,
  exchangeTimeoutMs: z.coerce.number().int().min(1),
  exchangeRateLimitMs: z.coerce.number().int().min(0),
  positionBroker: brokerSchema,
  counterPositionBroker: brokerSchema,
  timeframe: z.enum(['5m', '15m']),
  dryRun: z.boolean(),
  allowShort: z.boolean(),
  strategyKey: z.string().min(1),
  strategyVersion: z.string().min(1),
  signalN: z.coerce.number().int().min(1),
  signalK: z.coerce.number().min(0),
  signalHBars: z.coerce.number().int().min(1),
  fillModel: z.literal('next_open'),
  feeRate: z.coerce.number().min(0),
  slippageBps: z.coerce.number().min(0),
  positionSizingMode: z.literal('fixed_usdt'),
  fixedUsdtPerTrade: z.coerce.number().min(0),
  equityStartUsdt: z.coerce.number().min(0),
  maxOpenPositions: z.coerce.number().int().min(1),
  cooldownBars: z.coerce.number().int().min(0),
  stopLossPct: z.coerce.number().min(0),
  trailingProfile: trailingProfileSchema,
  trailingEnabled: z.boolean(),
  trailingActivationProfitPct: z.coerce.number().min(0),
  trailingGivebackRatio: z.coerce.number().min(0).max(1),
  trailingGivebackMinPct: z.coerce.number().min(0),
  trailingGivebackMaxPct: z.coerce.number().min(0),
  trailingMinLockedProfitPct: z.coerce.number().min(0),
  maxDailyDrawdownPct: z.coerce.number().min(0),
  maxConsecutiveLosses: z.coerce.number().int().min(0),
  pollIntervalMs: z.coerce.number().int().min(100),
});

const symbolIdParamsSchema = z.object({
  id: z.string().min(1),
});

const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
  eventFilters: z.array(z.string().min(1)).nullable().optional(),
  userLabel: z.string().max(255).nullable().optional(),
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

const parseOrReply = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown
): z.infer<TSchema> => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw Object.assign(new Error('Validation failed'), {
      statusCode: 400,
      payload: {
        error: 'Invalid request',
        details: parsed.error.flatten(),
      },
    });
  }

  return parsed.data as z.infer<TSchema>;
};

const toSymbolWriteModel = (input: z.infer<typeof symbolSettingsSchema>) => ({
  symbol: normalizeSymbol(input.symbol),
  active: input.active,
  exchange: input.exchange,
  exchangeTimeoutMs: input.exchangeTimeoutMs,
  exchangeRateLimitMs: input.exchangeRateLimitMs,
  positionBroker: input.positionBroker,
  counterPositionBroker: input.counterPositionBroker,
  timeframe: input.timeframe,
  dryRun: input.dryRun,
  allowShort: input.allowShort,
  strategyKey: input.strategyKey,
  strategyVersion: input.strategyVersion,
  signal: {
    n: input.signalN,
    k: input.signalK,
    hBars: input.signalHBars,
    timeframe: input.timeframe,
  },
  execution: {
    fillModel: input.fillModel,
    positionSizingMode: input.positionSizingMode,
    feeRate: input.feeRate,
    slippageBps: input.slippageBps,
    fixedUsdtPerTrade: input.fixedUsdtPerTrade,
    equityStartUsdt: input.equityStartUsdt,
  },
  maxOpenPositions: input.maxOpenPositions,
  cooldownBars: input.cooldownBars,
  stopLossPct: input.stopLossPct,
  trailingProfile: input.trailingProfile,
  trailingEnabled: input.trailingEnabled,
  trailingActivationProfitPct: input.trailingActivationProfitPct,
  trailingGivebackRatio: input.trailingGivebackRatio,
  trailingGivebackMinPct: input.trailingGivebackMinPct,
  trailingGivebackMaxPct: input.trailingGivebackMaxPct,
  trailingMinLockedProfitPct: input.trailingMinLockedProfitPct,
  maxDailyDrawdownPct: input.maxDailyDrawdownPct,
  maxConsecutiveLosses: input.maxConsecutiveLosses,
  pollIntervalMs: input.pollIntervalMs,
});

export const buildApp = async () => {
  const config = loadConfig();
  const logger = pino({
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization'],
      remove: true,
    },
  });

  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 240,
    timeWindow: '1 minute',
    skipOnError: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  const publicPaths = new Set(['/health', '/ready', '/metrics']);

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? request.url;

    if (request.method === 'OPTIONS' || publicPaths.has(pathname)) {
      return;
    }

    const bearerToken = getBearerToken(request.headers.authorization);
    const cookieToken = parseCookieHeader(request.headers.cookie)[
      SESSION_COOKIE_NAME
    ];
    const session = verifySessionToken(
      bearerToken ?? cookieToken ?? '',
      config.auth.sessionSecret
    );

    if (!session) {
      return reply.code(401).send({
        error: 'Unauthorized',
      });
    }
  });

  const db = createDatabase(config.databaseUrl);
  await db.migrate();
  await db.ensureDefaultSymbols(
    config.defaultSymbols,
    config.defaultSymbolSettings
  );

  const marketDataAdapters = new Map<string, MarketDataAdapter>();
  const getMarketDataAdapter = (params: {
    exchange: ExchangeName;
    exchangeTimeoutMs: number;
    exchangeRateLimitMs: number;
  }): MarketDataAdapter => {
    const key = `${params.exchange}:${params.exchangeTimeoutMs}:${params.exchangeRateLimitMs}`;
    const existing = marketDataAdapters.get(key);

    if (existing) {
      return existing;
    }

    const adapter = new MarketDataAdapter(
      {
        exchange: params.exchange,
        timeoutMs: params.exchangeTimeoutMs,
        rateLimitMs: params.exchangeRateLimitMs,
      },
      logger
    );

    marketDataAdapters.set(key, adapter);
    return adapter;
  };
  const getStartingEquity = async (): Promise<number> => {
    const symbols = (await db.listSymbols()).filter((symbol) => symbol.active);
    return symbols.reduce(
      (sum, symbol) => sum + Number(symbol.equity_start_usdt),
      0
    );
  };
  const notifications = new NotificationService(config, db, logger, () => {
    notificationFailuresCounter.inc();
  });
  const runner = new TradingRunner({
    config,
    db,
    notifications,
    logger,
  });

  await runner.init();

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request failed.');

    const statusCode = Number(
      (error as { statusCode?: number }).statusCode ?? 500
    );
    const payload = (error as { payload?: unknown }).payload;
    const message = error instanceof Error ? error.message : 'Unknown error';

    return reply.code(statusCode).send(
      payload ?? {
        error: statusCode >= 500 ? 'Internal Server Error' : message,
      }
    );
  });

  app.get('/health', async (request, reply) => {
    try {
      await db.ping();

      return {
        status: 'ok',
        service: 'medvedsson-crypto-api',
        db: 'up',
        runner: runner.getStatus(),
      };
    } catch (error) {
      request.log?.error?.({ err: error }, 'Health DB check failed.');
      return reply.code(503).send({
        status: 'degraded',
        service: 'medvedsson-crypto-api',
        db: 'down',
        runner: runner.getStatus(),
      });
    }
  });

  app.get('/ready', async () => {
    await db.ping();

    return {
      status: 'ready',
    };
  });

  app.get('/metrics', async (_, reply) => {
    const content = await runner.getMetricsRegistry().metrics();
    reply.header('content-type', runner.getMetricsRegistry().contentType);
    return content;
  });

  app.get('/runs', async () => ({
    runs: await db.listRuns(),
    runner: runner.getStatus(),
  }));

  app.post('/runs/start', async () => {
    const status = await runner.start();
    return { status };
  });

  app.post('/runs/stop', async () => {
    const status = await runner.stop();
    return { status };
  });

  app.get('/symbols', async () => ({
    symbols: await db.listSymbols(),
  }));

  app.post('/symbols', async (request) => {
    const body = parseOrReply(symbolSettingsSchema, request.body);
    return {
      symbol: await db.createSymbol(toSymbolWriteModel(body)),
    };
  });

  app.put('/symbols', async (request) => {
    const body = parseOrReply(symbolUpdateSchema, request.body);
    const symbols = body.symbols.map(normalizeSymbol);
    const updated = await db.replaceActiveSymbols(body.exchange, symbols, {
      ...config.defaultSymbolSettings,
      exchange: body.exchange,
    });
    return { symbols: updated };
  });

  app.put('/symbols/:id', async (request) => {
    const params = parseOrReply(symbolIdParamsSchema, request.params);
    const body = parseOrReply(symbolSettingsSchema, request.body);
    return {
      symbol: await db.updateSymbol(params.id, toSymbolWriteModel(body)),
    };
  });

  app.get('/signals/recent', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      signals: await db.getRecentSignals(query.limit, query.offset),
      page: query,
    };
  });

  app.get('/positions/open', async () => {
    const run = await db.getActiveRun();

    if (!run) {
      return { positions: [] };
    }

    return {
      positions: await db.getOpenPositions(run.id),
    };
  });

  app.get('/trades/recent', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      trades: await db.getRecentTrades(query.limit, query.offset),
      page: query,
    };
  });

  app.get('/stats/summary', async () => {
    const runs = await db.listRuns();
    const startingEquity = await getStartingEquity();

    if (runs.length === 0) {
      return {
        stats: {
          closedTrades: 0,
          winRate: 0,
          averageTradeReturn: 0,
          totalRealizedPnl: 0,
          equity: startingEquity,
          maxDrawdownPct: 0,
        },
      };
    }

    return {
      stats: await db.getStatsSummary(null, startingEquity),
    };
  });

  app.post('/push/subscribe', async (request) => {
    const body = parseOrReply(pushSubscribeSchema, request.body);

    const record: PushSubscriptionRecord = {
      endpoint: body.subscription.endpoint,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      enabled: true,
      eventFilters: body.eventFilters ?? null,
      userLabel: body.userLabel ?? null,
    };

    await db.upsertPushSubscription(record);

    return { ok: true };
  });

  app.post('/push/unsubscribe', async (request) => {
    const body = parseOrReply(pushUnsubscribeSchema, request.body);
    await db.disablePushSubscription(body.endpoint);
    return { ok: true };
  });

  app.get('/dashboard', async () => {
    const activeRun = await db.getActiveRun();
    const runs = await db.listRuns();
    const symbols = await db.listSymbols();
    const positions = activeRun ? await db.getOpenPositions(activeRun.id) : [];
    const today = getDayBoundsInTimeZone(new Date(), DASHBOARD_TIME_ZONE);
    const startingEquity = symbols
      .filter((symbol) => symbol.active)
      .reduce((sum, symbol) => sum + Number(symbol.equity_start_usdt), 0);
    const stats =
      runs.length > 0
        ? await db.getStatsSummary(null, startingEquity, {
            startTime: today.start,
            endTime: today.end,
          })
        : {
            closedTrades: 0,
            winRate: 0,
            averageTradeReturn: 0,
            totalRealizedPnl: 0,
            equity: startingEquity,
            maxDrawdownPct: 0,
          };
    const [todayRealizedPnl, todayCounterOrdersRealizedPnl] = await Promise.all(
      [
        db.getRealizedPnlBetween(today.start, today.end),
        db.getRealizedPnlBetween(today.start, today.end, {
          isCounterPosition: true,
        }),
      ]
    );

    return {
      activeSymbols: symbols.filter((symbol) => symbol.active),
      latestSignals: await db.getLatestSignalsBySymbol(),
      openPositionsCount: positions.length,
      todayCounterOrdersRealizedPnl,
      todayRealizedPnl,
      stats,
      runner: runner.getStatus(),
    };
  });

  app.get('/runner-status', async () => ({
    runner: runner.getStatus(),
  }));

  app.get('/signals', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      signals: await db.getRecentSignalsWithCandles(
        query.limit,
        query.offset,
        SIGNAL_CHART_CANDLE_COUNT
      ),
      page: query,
    };
  });

  app.get('/positions', async () => {
    const run = await db.getActiveRun();

    if (!run) {
      return {
        positions: [],
      };
    }

    return {
      positions: await db.getOpenPositions(run.id),
    };
  });

  app.get('/positions/:id/candles', async (request) => {
    const params = parseOrReply(symbolIdParamsSchema, request.params);
    const run = await db.getActiveRun();

    if (!run) {
      return {
        recent_candles: [],
      };
    }

    const position = (await db.getOpenPositions(run.id)).find(
      (item) => item.id === params.id
    );

    if (!position) {
      return {
        recent_candles: [],
      };
    }

    const symbol = await db.getSymbolById(position.symbol_id);

    try {
      return {
        recent_candles: await getMarketDataAdapter({
          exchange: symbol?.exchange ?? config.defaultSymbolSettings.exchange,
          exchangeTimeoutMs:
            symbol?.exchange_timeout_ms ??
            config.defaultSymbolSettings.exchangeTimeoutMs,
          exchangeRateLimitMs:
            symbol?.exchange_rate_limit_ms ??
            config.defaultSymbolSettings.exchangeRateLimitMs,
        }).fetchRecentCandles(
          position.symbol,
          POSITION_CHART_TIMEFRAME,
          POSITION_CHART_CANDLE_COUNT
        ),
      };
    } catch (error) {
      request.log.warn(
        {
          err: error,
          positionId: position.id,
          symbol: position.symbol,
          timeframe: POSITION_CHART_TIMEFRAME,
        },
        'Open position chart candle fetch failed.'
      );

      return {
        recent_candles: [],
      };
    }
  });

  app.get('/trades', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      trades: await db.getRecentTrades(query.limit, query.offset),
      page: query,
    };
  });

  app.get('/settings', async () => {
    const symbols = await db.listSymbols();

    return {
      vapidPublicKey: config.webPushVapidPublicKey,
      symbols,
      defaults: {
        symbol: '',
        active: true,
        exchange: config.defaultSymbolSettings.exchange,
        exchangeTimeoutMs: config.defaultSymbolSettings.exchangeTimeoutMs,
        exchangeRateLimitMs: config.defaultSymbolSettings.exchangeRateLimitMs,
        timeframe: config.defaultSymbolSettings.timeframe,
        dryRun: config.defaultSymbolSettings.dryRun,
        allowShort: config.defaultSymbolSettings.allowShort,
        strategyKey: config.defaultSymbolSettings.strategyKey,
        strategyVersion: config.defaultSymbolSettings.strategyVersion,
        signalN: config.defaultSymbolSettings.signal.n,
        signalK: config.defaultSymbolSettings.signal.k,
        signalHBars: config.defaultSymbolSettings.signal.hBars,
        fillModel: config.defaultSymbolSettings.execution.fillModel,
        feeRate: config.defaultSymbolSettings.execution.feeRate,
        slippageBps: config.defaultSymbolSettings.execution.slippageBps,
        positionSizingMode:
          config.defaultSymbolSettings.execution.positionSizingMode,
        fixedUsdtPerTrade:
          config.defaultSymbolSettings.execution.fixedUsdtPerTrade,
        equityStartUsdt: config.defaultSymbolSettings.execution.equityStartUsdt,
        maxOpenPositions: resolveMaxOpenPositions(
          config.defaultSymbolSettings.maxOpenPositions,
          symbols.length
        ),
        cooldownBars: config.defaultSymbolSettings.cooldownBars,
        stopLossPct: config.defaultSymbolSettings.stopLossPct,
        trailingProfile: config.defaultSymbolSettings.trailingProfile,
        trailingEnabled: config.defaultSymbolSettings.trailingEnabled,
        trailingActivationProfitPct:
          config.defaultSymbolSettings.trailingActivationProfitPct,
        trailingGivebackRatio:
          config.defaultSymbolSettings.trailingGivebackRatio,
        trailingGivebackMinPct:
          config.defaultSymbolSettings.trailingGivebackMinPct,
        trailingGivebackMaxPct:
          config.defaultSymbolSettings.trailingGivebackMaxPct,
        trailingMinLockedProfitPct:
          config.defaultSymbolSettings.trailingMinLockedProfitPct,
        maxDailyDrawdownPct: config.defaultSymbolSettings.maxDailyDrawdownPct,
        maxConsecutiveLosses: config.defaultSymbolSettings.maxConsecutiveLosses,
        pollIntervalMs: config.defaultSymbolSettings.pollIntervalMs,
      },
    };
  });

  app.addHook('onClose', async () => {
    await runner.stop();
    await db.close();
  });

  return { app, config, runner, db };
};
