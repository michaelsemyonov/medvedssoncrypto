import cors from '@fastify/cors';
import { TradingRunner } from '@medvedsson/core';
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
    loggerInstance: logger
  });

  await app.register(cors, {
    origin: true,
    credentials: true
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
  const notifications = new NotificationService(config, db, logger);
  const runner = new TradingRunner({
    config,
    db,
    marketData,
    notifications,
    logger
  });

  await runner.init();

  app.get('/health', async () => ({
    status: 'ok',
    service: 'medvedsson-crypto-api',
    runner: runner.getStatus()
  }));

  app.get('/ready', async () => {
    await db.listRuns();

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
    const body = request.body as { symbols?: string[] };
    const symbols = (body.symbols ?? []).map(normalizeSymbol);
    const updated = await db.replaceActiveSymbols(config.exchange, symbols);
    return { symbols: updated };
  });

  app.get('/signals/recent', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 100);
    return {
      signals: await db.getRecentSignals(limit)
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
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 100);
    return {
      trades: await db.getRecentTrades(limit)
    };
  });

  app.get('/stats/summary', async () => {
    const run = await db.getActiveRun();

    if (!run) {
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
      stats: await db.getStatsSummary(run.id, config.execution.equityStartUsdt)
    };
  });

  app.post('/push/subscribe', async (request) => {
    const body = request.body as {
      subscription: {
        endpoint: string;
        keys: {
          p256dh: string;
          auth: string;
        };
      };
      symbolFilters?: string[] | null;
      eventFilters?: string[] | null;
      userLabel?: string | null;
    };

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
    const body = request.body as { endpoint: string };
    await db.disablePushSubscription(body.endpoint);
    return { ok: true };
  });

  app.get('/dashboard', async () => {
    const run = await db.getActiveRun();
    const positions = run ? await db.getOpenPositions(run.id) : [];
    const stats = run
      ? await db.getStatsSummary(run.id, config.execution.equityStartUsdt)
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
    const query = request.query as { limit?: string };
    return {
      signals: await db.getRecentSignals(Number(query.limit ?? 100))
    };
  });

  app.get('/positions', async () => {
    const run = await db.getActiveRun();
    return {
      positions: run ? await db.getOpenPositions(run.id) : []
    };
  });

  app.get('/trades', async (request) => {
    const query = request.query as { limit?: string };
    return {
      trades: await db.getRecentTrades(Number(query.limit ?? 100))
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

  if (config.runnerAutostart) {
    await runner.start();
  }

  return { app, config, runner, db };
};
