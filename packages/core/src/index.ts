import type { MedvedssonDatabase } from '@medvedsson/db';
import {
  DryRunExecutionAdapter,
  type ExecutionAdapter,
  evaluateRisk,
} from '@medvedsson/execution';
import {
  analyzeCandleSeries,
  MarketDataAdapter,
  mergeCandles,
} from '@medvedsson/market-data';
import type { NotificationService } from '@medvedsson/notifications';
import type { AppConfig, Candle } from '@medvedsson/shared';
import { round, SIGNAL_TYPES, timeframeToMs } from '@medvedsson/shared';
import {
  evaluateMomentumStrategy,
  requiredCandles,
} from '@medvedsson/strategy';

import {
  candlesProcessedCounter,
  candleLagGauge,
  dbWriteErrorsCounter,
  drawdownGauge,
  duplicateCandlesSkippedCounter,
  marketDataLatencyGauge,
  metricsRegistry,
  openPositionsGauge,
  realizedPnlGauge,
  runnerErrorsCounter,
  signalDecisionCounter,
  signalsCreatedCounter,
  simulatedOrdersCounter,
  unrealizedPnlGauge,
} from './metrics.ts';

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type RunnerStatus = {
  running: boolean;
  runId: string | null;
  lastTickStartedAt: string | null;
  lastTickCompletedAt: string | null;
  lastError: string | null;
};

const isDatabaseError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & {
    code?: string;
    errno?: number;
    sqlState?: string;
    sqlMessage?: string;
  };

  return Boolean(
    candidate.errno !== undefined ||
    candidate.sqlState ||
    candidate.sqlMessage ||
    candidate.code?.startsWith('ER_')
  );
};

export class TradingRunner {
  private readonly config: AppConfig;
  private readonly db: MedvedssonDatabase;
  private readonly marketData: MarketDataAdapter;
  private readonly notifications: NotificationService;
  private readonly logger: LoggerLike;
  private readonly executionAdapter: ExecutionAdapter;
  private timeoutHandle: NodeJS.Timeout | null = null;
  private running = false;
  private activeRunId: string | null = null;
  private lastTickStartedAt: string | null = null;
  private lastTickCompletedAt: string | null = null;
  private lastError: string | null = null;

  constructor(params: {
    config: AppConfig;
    db: MedvedssonDatabase;
    marketData: MarketDataAdapter;
    notifications: NotificationService;
    logger: LoggerLike;
    executionAdapter?: ExecutionAdapter;
  }) {
    this.config = params.config;
    this.db = params.db;
    this.marketData = params.marketData;
    this.notifications = params.notifications;
    this.logger = params.logger;
    this.executionAdapter =
      params.executionAdapter ??
      new DryRunExecutionAdapter(params.db, params.config.execution);
  }

  async init(): Promise<void> {
    await this.db.replaceActiveSymbols(
      this.config.exchange,
      this.config.symbols
    );
  }

  getStatus(): RunnerStatus {
    return {
      running: this.running,
      runId: this.activeRunId,
      lastTickStartedAt: this.lastTickStartedAt,
      lastTickCompletedAt: this.lastTickCompletedAt,
      lastError: this.lastError,
    };
  }

  getMetricsRegistry() {
    return metricsRegistry;
  }

  async start(): Promise<RunnerStatus> {
    if (this.running) {
      return this.getStatus();
    }

    const run = await this.db.startRun(this.config);
    this.activeRunId = run.id;
    this.running = true;
    await this.tick();
    return this.getStatus();
  }

  async stop(): Promise<RunnerStatus> {
    this.running = false;

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    if (this.activeRunId) {
      await this.db.stopRun(this.activeRunId);
    }

    this.activeRunId = null;
    return this.getStatus();
  }

  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }

    this.timeoutHandle = setTimeout(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
  }

  private computeCooldownRemainingBars(
    lastExitTime: string | null,
    currentCloseTime: string
  ): number {
    if (!lastExitTime) {
      return 0;
    }

    const elapsedBars = Math.floor(
      (new Date(currentCloseTime).getTime() -
        new Date(lastExitTime).getTime()) /
        timeframeToMs(this.config.timeframe)
    );

    return Math.max(0, this.config.cooldownBars - elapsedBars);
  }

  private async recordEquity(
    runId: string,
    snapshotTime: string
  ): Promise<void> {
    const openPositions = await this.db.getOpenPositionsCount(runId);
    const unrealizedPnl = await this.db.computeUnrealizedPnl(runId);
    const realizedPnlCum = await this.db.getRealizedPnlCum(runId);
    const balanceUsdt = round(
      this.config.execution.equityStartUsdt + realizedPnlCum,
      8
    );
    const equityUsdt = round(balanceUsdt + unrealizedPnl, 8);

    await this.db.recordEquitySnapshot({
      runId,
      snapshotTime,
      balanceUsdt,
      equityUsdt,
      unrealizedPnl,
      realizedPnlCum,
      openPositions,
    });

    openPositionsGauge.set(openPositions);
    realizedPnlGauge.set(realizedPnlCum);
    unrealizedPnlGauge.set(unrealizedPnl);
    drawdownGauge.set(await this.db.getCurrentDrawdownPct(runId));
  }

  private async processPendingOrders(
    runId: string,
    symbolId: string,
    candle: Candle
  ): Promise<void> {
    await this.executionAdapter.processPendingFills({
      runId,
      symbolId,
      openPrice: candle.open,
      openTime: candle.openTime,
    });
  }

  private async finalizeProcessedCandle(
    runId: string,
    symbol: Awaited<ReturnType<MedvedssonDatabase['listSymbols']>>[number],
    candle: Candle
  ): Promise<void> {
    candlesProcessedCounter.inc({
      symbol: symbol.symbol,
    });

    candleLagGauge.set(
      {
        symbol: symbol.symbol,
      },
      Date.now() - new Date(candle.closeTime).getTime()
    );

    await this.recordEquity(runId, candle.closeTime);
  }

  private async processCandle(
    runId: string,
    symbol: Awaited<ReturnType<MedvedssonDatabase['listSymbols']>>[number],
    candle: Candle,
    history: Candle[]
  ): Promise<void> {
    await this.processPendingOrders(runId, symbol.id, candle);

    const openPosition = await this.db.getOpenPosition(runId, symbol.id);
    const signal = evaluateMomentumStrategy(
      history,
      this.config.signal,
      openPosition
    );

    if (signal.signalType === SIGNAL_TYPES.NO_SIGNAL) {
      await this.db.recordProcessedCandle({
        runId,
        symbolId: symbol.id,
        candleCloseTime: signal.candleCloseTime,
      });
      await this.finalizeProcessedCandle(runId, symbol, candle);
      return;
    }

    const signalRow = await this.db.insertSignal({
      runId,
      symbolId: symbol.id,
      exchange: symbol.exchange,
      symbol: symbol.symbol,
      timeframe: this.config.timeframe,
      signal,
    });
    await this.db.recordProcessedCandle({
      runId,
      symbolId: symbol.id,
      candleCloseTime: signal.candleCloseTime,
    });

    signalsCreatedCounter.inc({
      symbol: symbol.symbol,
      signal_type: signal.signalType,
    });

    const lastClosedPosition = await this.db.getLastClosedPosition(
      runId,
      symbol.id
    );
    const cooldownRemainingBars = this.computeCooldownRemainingBars(
      lastClosedPosition?.exit_time?.toISOString() ?? null,
      candle.closeTime
    );

    const decision = evaluateRisk({
      signal,
      symbolEnabled: symbol.active,
      enoughHistory: history.length >= requiredCandles(this.config.signal),
      allowShort: this.config.allowShort,
      maxOpenPositions: this.config.maxOpenPositions,
      openPositionsCount: await this.db.getOpenPositionsCount(runId),
      openPosition,
      cooldownRemainingBars,
      currentDrawdownPct: await this.db.getCurrentDrawdownPct(runId),
      maxDailyDrawdownPct: this.config.maxDailyDrawdownPct,
      consecutiveLosses: await this.db.getConsecutiveLosses(runId),
      maxConsecutiveLosses: this.config.maxConsecutiveLosses,
    });

    await this.db.updateSignalDecision(signalRow.id, decision);
    await this.db.insertRiskEvent({
      runId,
      signalId: signalRow.id,
      symbolId: symbol.id,
      decision,
    });

    signalDecisionCounter.inc({
      symbol: symbol.symbol,
      approved: String(decision.approved),
    });

    if (decision.approved) {
      const executionResult = await this.executionAdapter.handleApprovedSignal({
        runId,
        signalId: signalRow.id,
        symbolId: symbol.id,
        signalType: signal.signalType,
        referencePrice: candle.close,
        scheduledForOpenTime: candle.closeTime,
        openPosition,
      });

      if (executionResult.orderCreated && executionResult.intent) {
        simulatedOrdersCounter.inc({
          symbol: symbol.symbol,
          intent: executionResult.intent,
        });
      }

      await this.notifications.notifySignal({
        symbol: symbol.symbol,
        signalType: signal.signalType,
        signalTime: signal.candleCloseTime,
        strategyVersion: this.config.strategyVersion,
        reason: signal.reason,
        approved: true,
        referencePrice: candle.close,
      });
    } else {
      await this.notifications.notifySignal({
        symbol: symbol.symbol,
        signalType: signal.signalType,
        signalTime: signal.candleCloseTime,
        strategyVersion: this.config.strategyVersion,
        reason: decision.rejectionReason ?? signal.reason,
        approved: false,
        referencePrice: candle.close,
      });
    }

    await this.finalizeProcessedCandle(runId, symbol, candle);
  }

  private async processSymbol(
    runId: string,
    symbol: Awaited<ReturnType<MedvedssonDatabase['listSymbols']>>[number]
  ): Promise<void> {
    const historyLimit = Math.max(
      this.config.signal.n + this.config.signal.hBars + 8,
      192
    );
    const cachedCandles = this.config.enableCandleStorage
      ? await this.db.getRecentCandles(
          this.config.exchange,
          symbol.symbol,
          this.config.timeframe,
          historyLimit
        )
      : [];
    let exchangeCandles: Candle[] = [];
    let usedCacheFallback = false;
    const startedAt = Date.now();

    try {
      exchangeCandles = await this.marketData.fetchRecentCandles(
        symbol.symbol,
        this.config.timeframe,
        historyLimit
      );

      marketDataLatencyGauge.set(
        { symbol: symbol.symbol },
        Date.now() - startedAt
      );
    } catch (error) {
      usedCacheFallback = true;
      this.logger.warn(
        { error, symbol: symbol.symbol },
        'Exchange candle fetch failed; falling back to cached candles.'
      );
    }

    const exchangeDiagnostics = analyzeCandleSeries(
      exchangeCandles,
      this.config.timeframe
    );

    if (exchangeDiagnostics.issues.length > 0) {
      this.logger.warn(
        { symbol: symbol.symbol, diagnostics: exchangeDiagnostics },
        'Exchange candle quality issue detected.'
      );
    }

    if (exchangeCandles.length > 0 && this.config.enableCandleStorage) {
      await this.db.upsertCandles(exchangeCandles);
    }

    const candles = mergeCandles(cachedCandles, exchangeCandles);
    const combinedDiagnostics = analyzeCandleSeries(
      candles,
      this.config.timeframe
    );

    if (combinedDiagnostics.issues.length > 0) {
      this.logger.warn(
        {
          symbol: symbol.symbol,
          diagnostics: combinedDiagnostics,
          usedCacheFallback,
        },
        'Merged candle quality issue detected.'
      );
    }

    if (candles.length === 0) {
      return;
    }

    const lastProcessed = await this.db.getLastProcessedCloseTime(
      runId,
      symbol.id
    );
    const candidates = candles.filter(
      (candle) =>
        !lastProcessed ||
        new Date(candle.closeTime).getTime() > new Date(lastProcessed).getTime()
    );

    if (candidates.length === 0) {
      duplicateCandlesSkippedCounter.inc({ symbol: symbol.symbol });
      return;
    }

    for (const candidate of candidates) {
      const history = candles.filter(
        (candle) =>
          new Date(candle.closeTime).getTime() <=
          new Date(candidate.closeTime).getTime()
      );

      await this.processCandle(runId, symbol, candidate, history);
    }
  }

  async tick(): Promise<void> {
    if (!this.running || !this.activeRunId) {
      return;
    }

    this.lastTickStartedAt = new Date().toISOString();
    this.lastError = null;

    try {
      const symbols = (await this.db.listSymbols()).filter(
        (symbol) => symbol.active
      );

      for (const symbol of symbols) {
        await this.processSymbol(this.activeRunId, symbol);
      }

      this.lastTickCompletedAt = new Date().toISOString();
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : 'Unknown runner error';
      runnerErrorsCounter.inc();

      if (isDatabaseError(error)) {
        dbWriteErrorsCounter.inc();
      }

      this.logger.error({ error }, 'Runner tick failed.');
      await this.notifications.notifyRunnerError(this.lastError);
    } finally {
      this.scheduleNextTick();
    }
  }
}

export * from './metrics.ts';
