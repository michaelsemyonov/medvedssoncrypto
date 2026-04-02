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
  round,
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

import {
  buildCredentialUpdate,
  buildMaskedExchangeAccount,
  createExchangeClient,
  decryptSecret,
  type ManagedExchange,
} from './exchange-integrations.ts';

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
const managedExchangeSchema = z.enum(['bybit', 'okx']);

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

const exchangeParamsSchema = z.object({
  exchange: managedExchangeSchema,
});

const exchangeCredentialsSchema = z.object({
  apiKey: z.string().default(''),
  apiSecret: z.string().default(''),
  apiPassphrase: z.string().default(''),
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
  const getExchangeCredentials = async (
    exchange: ManagedExchange
  ): Promise<{
    account: Awaited<ReturnType<typeof db.getExchangeAccount>>;
    client: ReturnType<typeof createExchangeClient>;
  }> => {
    const account = await db.getExchangeAccount(exchange);

    if (
      !account?.api_key_ciphertext ||
      !account.api_secret_ciphertext ||
      !account.has_api_key ||
      !account.has_api_secret
    ) {
      throw new Error(`${exchange.toUpperCase()} credentials are not configured.`);
    }

    const credentials = {
      exchange,
      apiKey: decryptSecret(
        account.api_key_ciphertext,
        config.auth.sessionSecret
      ),
      apiSecret: decryptSecret(
        account.api_secret_ciphertext,
        config.auth.sessionSecret
      ),
      apiPassphrase:
        exchange === 'okx'
          ? account.api_passphrase_ciphertext
            ? decryptSecret(
                account.api_passphrase_ciphertext,
                config.auth.sessionSecret
              )
            : null
          : null,
    };

    return {
      account,
      client: createExchangeClient(credentials),
    };
  };
  const syncManagedExchangePositions = async (exchange: ManagedExchange) => {
    const { client } = await getExchangeCredentials(exchange);
    const validatedAt = new Date().toISOString();
    await client.validate();
    const importedPositions = await client.listOpenPositions();
    const activeRun = await db.getActiveRun();
    const appPositions = activeRun ? await db.getOpenPositions(activeRun.id) : [];
    const appPositionMap = new Map<string, string>();

    for (const position of appPositions) {
      const key = `${position.broker}:${position.symbol}:${position.side}`;

      if (!appPositionMap.has(key)) {
        appPositionMap.set(key, position.id);
      }
    }

    const syncedAt = new Date().toISOString();
    const syncSummary = await db.syncExchangePositions({
      exchange,
      syncedAt,
      positions: importedPositions.map((position) => ({
        exchange: position.exchange,
        externalPositionId: position.externalPositionId,
        instrumentId: position.instrumentId,
        symbol: position.symbol,
        side: position.side,
        qty: position.qty,
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        notionalUsdt: position.notionalUsdt,
        unrealizedPnl: position.unrealizedPnl,
        stopLossPrice: position.stopLossPrice,
        linkedPositionId:
          appPositionMap.get(
            `${position.exchange}:${position.symbol}:${position.side}`
          ) ?? null,
        openedAt: position.openedAt,
        syncedAt,
        meta: position.meta,
      })),
    });

    await db.updateExchangeAccountSyncStatus({
      exchange,
      validatedAt,
      syncedAt,
      syncError: null,
    });

    return {
      positions: importedPositions,
      summary: syncSummary,
      syncedAt,
    };
  };
  const getUnifiedOpenPositions = async (): Promise<
    Array<
      Awaited<ReturnType<typeof db.getOpenPositions>>[number] & {
        position_source: 'simulated' | 'exchange';
        linked_position_id: string | null;
        stop_loss_price: number | null;
        last_synced_at: string | null;
        supports_trailing: boolean;
      }
    >
  > => {
    const activeRun = await db.getActiveRun();
    const appPositions = activeRun ? await db.getOpenPositions(activeRun.id) : [];
    const exchangePositions = await db.listOpenExchangePositions();

    const unified = [
      ...appPositions.map((position) => ({
        ...position,
        position_source: 'simulated' as const,
        linked_position_id: null,
        stop_loss_price: null,
        last_synced_at: null,
        supports_trailing: true,
      })),
      ...exchangePositions.map((position) => ({
        id: position.id,
        strategy_run_id: '',
        symbol_id: '',
        broker: position.exchange,
        is_counter_position: false,
        side: position.side,
        status: position.status,
        entry_time: position.opened_at ?? position.synced_at,
        exit_time: null,
        entry_price: position.entry_price,
        exit_price: null,
        qty: position.qty,
        notional_usdt: position.notional_usdt,
        entry_fee: 0,
        exit_fee: null,
        realized_pnl: null,
        opened_by_signal_id: '',
        closed_by_signal_id: null,
        created_at: position.created_at,
        updated_at: position.updated_at,
        symbol: position.symbol,
        unrealized_pnl: position.unrealized_pnl,
        trailing_profile: 'external',
        trailing_enabled: false,
        trailing_activation_profit_pct: 0,
        trailing_giveback_ratio: 0,
        trailing_giveback_min_pct: 0,
        trailing_giveback_max_pct: 0,
        trailing_min_locked_profit_pct: 0,
        trailing_armed: false,
        trailing_current_profit_pct: null,
        trailing_peak_profit_pct: null,
        trailing_giveback_pct: null,
        trailing_allowed_giveback_pct: null,
        position_source: 'exchange' as const,
        linked_position_id: position.linked_position_id,
        stop_loss_price: position.stop_loss_price,
        last_synced_at: position.synced_at.toISOString(),
        supports_trailing: false,
      })),
    ];

    return unified.sort((left, right) => left.symbol.localeCompare(right.symbol));
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

  app.put('/exchange-accounts/:exchange', async (request) => {
    const params = parseOrReply(exchangeParamsSchema, request.params);
    const body = parseOrReply(exchangeCredentialsSchema, request.body);
    const existing = await db.getExchangeAccount(params.exchange);
    const updated = buildCredentialUpdate({
      exchange: params.exchange,
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      apiPassphrase: body.apiPassphrase,
      existing,
      encryptionSecret: config.auth.sessionSecret,
    });

    await db.upsertExchangeAccount({
      exchange: params.exchange,
      apiKeyCiphertext: updated.apiKeyCiphertext,
      apiSecretCiphertext: updated.apiSecretCiphertext,
      apiPassphraseCiphertext: updated.apiPassphraseCiphertext,
      apiKeyMask: updated.apiKeyMask,
      hasApiKey: updated.hasApiKey,
      hasApiSecret: updated.hasApiSecret,
      hasApiPassphrase: updated.hasApiPassphrase,
      lastValidatedAt: existing?.last_validated_at?.toISOString() ?? null,
      lastSyncAt: existing?.last_sync_at?.toISOString() ?? null,
      lastSyncError: existing?.last_sync_error ?? null,
    });

    return {
      account: buildMaskedExchangeAccount({
        exchange: params.exchange,
        apiKeyMask: updated.apiKeyMask,
        hasApiKey: updated.hasApiKey,
        hasApiSecret: updated.hasApiSecret,
        hasApiPassphrase: updated.hasApiPassphrase,
        lastValidatedAt: existing?.last_validated_at ?? null,
        lastSyncAt: existing?.last_sync_at ?? null,
        lastSyncError: existing?.last_sync_error ?? null,
      }),
    };
  });

  app.post('/exchange-accounts/:exchange/sync-positions', async (request) => {
    const params = parseOrReply(exchangeParamsSchema, request.params);

    try {
      const result = await syncManagedExchangePositions(params.exchange);
      return {
        validatedAt: result.syncedAt,
        syncedAt: result.syncedAt,
        summary: result.summary,
        positions: result.positions.length,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Exchange sync failed.';
      await db.updateExchangeAccountSyncStatus({
        exchange: params.exchange,
        syncError: message,
      });
      throw error;
    }
  });

  app.post('/exchange-accounts/:exchange/apply-stop-losses', async (request) => {
    const params = parseOrReply(exchangeParamsSchema, request.params);

    try {
      const { client } = await getExchangeCredentials(params.exchange);
      const validatedAt = new Date().toISOString();
      await client.validate();

      const synced = await syncManagedExchangePositions(params.exchange);
      const symbols = await db.listSymbols();
      const symbolSettings = new Map(
        symbols.map((symbol) => [symbol.symbol, symbol])
      );
      let updatedCount = 0;

      for (const position of synced.positions) {
        const symbol = symbolSettings.get(position.symbol);

        if (!symbol || symbol.position_broker !== params.exchange) {
          continue;
        }

        if (symbol.stop_loss_pct <= 0) {
          continue;
        }

        const stopLossPrice =
          position.side === 'LONG'
            ? round(position.entryPrice * (1 - symbol.stop_loss_pct / 100), 8)
            : round(position.entryPrice * (1 + symbol.stop_loss_pct / 100), 8);

        await client.applyStopLoss(position, stopLossPrice);
        updatedCount += 1;
      }

      const refreshed = await syncManagedExchangePositions(params.exchange);
      await db.updateExchangeAccountSyncStatus({
        exchange: params.exchange,
        validatedAt,
        syncedAt: refreshed.syncedAt,
        syncError: null,
      });

      return {
        validatedAt,
        syncedAt: refreshed.syncedAt,
        summary: refreshed.summary,
        updated: updatedCount,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Stop-loss update failed.';
      await db.updateExchangeAccountSyncStatus({
        exchange: params.exchange,
        syncError: message,
      });
      throw error;
    }
  });

  app.get('/signals/recent', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      signals: await db.getRecentSignals(query.limit, query.offset),
      page: query,
    };
  });

  app.get('/positions/open', async () => {
    return {
      positions: await getUnifiedOpenPositions(),
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

  app.get('/runner-status', () => ({
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
    return {
      positions: await getUnifiedOpenPositions(),
    };
  });

  app.get('/positions/:id/candles', async (request) => {
    const params = parseOrReply(symbolIdParamsSchema, request.params);
    const run = await db.getActiveRun();
    const appPosition = run
      ? (await db.getOpenPositions(run.id)).find((item) => item.id === params.id)
      : null;
    const exchangePosition = appPosition
      ? null
      : await db.getExchangePositionById(params.id);

    if (!appPosition && !exchangePosition) {
      return {
        recent_candles: [],
      };
    }

    const trackedSymbol = appPosition?.symbol ?? exchangePosition?.symbol ?? '';
    const symbol =
      appPosition && appPosition.symbol_id
        ? await db.getSymbolById(appPosition.symbol_id)
        : (await db.listSymbols()).find(
            (item) =>
              item.symbol === trackedSymbol &&
              (item.position_broker === exchangePosition?.exchange ||
                item.exchange === exchangePosition?.exchange)
          ) ?? null;

    try {
      return {
        recent_candles: await getMarketDataAdapter({
          exchange:
            symbol?.exchange ??
            exchangePosition?.exchange ??
            config.defaultSymbolSettings.exchange,
          exchangeTimeoutMs:
            symbol?.exchange_timeout_ms ??
            config.defaultSymbolSettings.exchangeTimeoutMs,
          exchangeRateLimitMs:
            symbol?.exchange_rate_limit_ms ??
            config.defaultSymbolSettings.exchangeRateLimitMs,
        }).fetchRecentCandles(
          trackedSymbol,
          POSITION_CHART_TIMEFRAME,
          POSITION_CHART_CANDLE_COUNT
        ),
      };
    } catch (error) {
      request.log.warn(
        {
          err: error,
          positionId: params.id,
          symbol: trackedSymbol,
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
    const exchangeAccounts = await db.listExchangeAccounts();

    return {
      vapidPublicKey: config.webPushVapidPublicKey,
      symbols,
      exchangeAccounts: exchangeAccounts.map((account) =>
        buildMaskedExchangeAccount({
          exchange: account.exchange,
          apiKeyMask: account.api_key_mask,
          hasApiKey: account.has_api_key,
          hasApiSecret: account.has_api_secret,
          hasApiPassphrase: account.has_api_passphrase,
          lastValidatedAt: account.last_validated_at,
          lastSyncAt: account.last_sync_at,
          lastSyncError: account.last_sync_error,
        })
      ),
      defaults: {
        symbol: '',
        active: true,
        exchange: config.defaultSymbolSettings.exchange,
        exchangeTimeoutMs: config.defaultSymbolSettings.exchangeTimeoutMs,
        exchangeRateLimitMs: config.defaultSymbolSettings.exchangeRateLimitMs,
        positionBroker: config.defaultSymbolSettings.positionBroker,
        counterPositionBroker:
          config.defaultSymbolSettings.counterPositionBroker,
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
