import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { notificationFailuresCounter, TradingRunner } from '@medvedsson/core';
import { createDatabase } from '@medvedsson/db';
import { MarketDataAdapter } from '@medvedsson/market-data';
import { NotificationService } from '@medvedsson/notifications';
import {
  getBearerToken,
  loadConfig,
  normalizeSymbol,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  type PushSubscriptionRecord,
  verifySessionToken
} from '@medvedsson/shared';
import Fastify from 'fastify';
import pino from 'pino';
import { z } from 'zod';

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

const symbolUpdateSchema = z.object({
  symbols: z.array(z.string().min(1)).default([])
});

const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1)
    })
  }),
  symbolFilters: z.array(z.string().min(1)).nullable().optional(),
  eventFilters: z.array(z.string().min(1)).nullable().optional(),
  userLabel: z.string().max(255).nullable().optional()
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url()
});

const parseOrReply = <TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown): z.infer<TSchema> => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw Object.assign(new Error('Validation failed'), {
      statusCode: 400,
      payload: {
        error: 'Invalid request',
        details: parsed.error.flatten()
      }
    });
  }

  return parsed.data as z.infer<TSchema>;
};

export const buildApp = async () => {
  const config = loadConfig();
  const logger = pino({
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization'],
      remove: true
    }
  });

  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id'
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await app.register(rateLimit, {
    max: 240,
    timeWindow: '1 minute',
    skipOnError: true
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
    const cookieToken = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
    const session = verifySessionToken(
      bearerToken ?? cookieToken ?? '',
      config.auth.sessionSecret
    );

    if (!session) {
      return reply.code(401).send({
        error: 'Unauthorized'
      });
    }
  });

  const db = createDatabase(config.databaseUrl);
  await db.migrate();
  await db.replaceActiveSymbols(config.exchange, config.symbols);

  const marketData = new MarketDataAdapter(
    {
      exchange: config.exchange,
      timeoutMs: config.exchangeTimeoutMs,
      rateLimitMs: config.exchangeRateLimitMs
    },
    logger
  );
  const notifications = new NotificationService(config, db, logger, () => {
    notificationFailuresCounter.inc();
  });
  const runner = new TradingRunner({
    config,
    db,
    marketData,
    notifications,
    logger
  });

  await runner.init();

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request failed.');

    const statusCode = Number((error as { statusCode?: number }).statusCode ?? 500);
    const payload = (error as { payload?: unknown }).payload;
    const message = error instanceof Error ? error.message : 'Unknown error';

    return reply.code(statusCode).send(
      payload ?? {
        error: statusCode >= 500 ? 'Internal Server Error' : message
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
        runner: runner.getStatus()
      };
    } catch (error) {
      request.log?.error?.({ err: error }, 'Health DB check failed.');
      return reply.code(503).send({
        status: 'degraded',
        service: 'medvedsson-crypto-api',
        db: 'down',
        runner: runner.getStatus()
      });
    }
  });

  app.get('/ready', async () => {
    await db.ping();

    return {
      status: 'ready'
    };
  });

  app.get('/metrics', async (_, reply) => {
    const content = await runner.getMetricsRegistry().metrics();
    reply.header('content-type', runner.getMetricsRegistry().contentType);
    return content;
  });

  app.get('/runs', async () => ({
    runs: await db.listRuns(),
    runner: runner.getStatus()
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
    symbols: await db.listSymbols()
  }));

  app.put('/symbols', async (request) => {
    const body = parseOrReply(symbolUpdateSchema, request.body);
    const symbols = body.symbols.map(normalizeSymbol);
    const updated = await db.replaceActiveSymbols(config.exchange, symbols);
    return { symbols: updated };
  });

  app.get('/signals/recent', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      signals: await db.getRecentSignals(query.limit, query.offset),
      page: query
    };
  });

  app.get('/positions/open', async () => {
    const run = await db.getActiveRun();

    if (!run) {
      return { positions: [] };
    }

    return {
      positions: await db.getOpenPositions(run.id)
    };
  });

  app.get('/trades/recent', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      trades: await db.getRecentTrades(query.limit, query.offset),
      page: query
    };
  });

  app.get('/stats/summary', async () => {
    const runs = await db.listRuns();

    if (runs.length === 0) {
      return {
        stats: {
          closedTrades: 0,
          winRate: 0,
          averageTradeReturn: 0,
          totalRealizedPnl: 0,
          equity: config.execution.equityStartUsdt,
          maxDrawdownPct: 0
        }
      };
    }

    return {
      stats: await db.getStatsSummary(null, config.execution.equityStartUsdt)
    };
  });

  app.post('/push/subscribe', async (request) => {
    const body = parseOrReply(pushSubscribeSchema, request.body);

    const record: PushSubscriptionRecord = {
      endpoint: body.subscription.endpoint,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      enabled: true,
      symbolFilters: body.symbolFilters?.map(normalizeSymbol) ?? null,
      eventFilters: body.eventFilters ?? null,
      userLabel: body.userLabel ?? null
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
    const positions = activeRun ? await db.getOpenPositions(activeRun.id) : [];
    const stats = runs.length > 0
      ? await db.getStatsSummary(null, config.execution.equityStartUsdt)
      : {
          closedTrades: 0,
          winRate: 0,
          averageTradeReturn: 0,
          totalRealizedPnl: 0,
          equity: config.execution.equityStartUsdt,
          maxDrawdownPct: 0
        };

    return {
      activeSymbols: (await db.listSymbols()).filter((symbol) => symbol.active),
      latestSignals: await db.getLatestSignalsBySymbol(),
      openPositionsCount: positions.length,
      stats,
      runner: runner.getStatus()
    };
  });

  app.get('/signals', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      signals: await db.getRecentSignals(query.limit, query.offset),
      page: query
    };
  });

  app.get('/positions', async () => {
    const run = await db.getActiveRun();
    return {
      positions: run ? await db.getOpenPositions(run.id) : []
    };
  });

  app.get('/trades', async (request) => {
    const query = parseOrReply(paginationQuerySchema, request.query);
    return {
      trades: await db.getRecentTrades(query.limit, query.offset),
      page: query
    };
  });

  app.get('/settings', async () => ({
    vapidPublicKey: config.webPushVapidPublicKey,
    symbols: (await db.listSymbols()).filter((symbol) => symbol.active).map((symbol) => symbol.symbol),
    exchange: config.exchange,
    timeframe: config.timeframe,
    strategyKey: config.strategyKey,
    strategyVersion: config.strategyVersion,
    dryRun: config.dryRun
  }));

  app.addHook('onClose', async () => {
    await runner.stop();
    await db.close();
  });

  return { app, config, runner, db };
};
