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
import type {
  AppConfig,
  Candle,
  SymbolRuntimeSettings,
} from '@medvedsson/shared';
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
  debug: (payload: unknown, message?: string) => void;
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

type MarketDataClient = Pick<MarketDataAdapter, 'fetchRecentCandles'>;
type SymbolRecord = Awaited<
  ReturnType<MedvedssonDatabase['listSymbols']>
>[number];

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
  private readonly marketDataOverride: MarketDataClient | null;
  private readonly notifications: NotificationService;
  private readonly logger: LoggerLike;
  private readonly executionAdapterOverride: ExecutionAdapter | null;
  private readonly marketDataAdapters = new Map<string, MarketDataAdapter>();
  private readonly lastPolledAtBySymbolId = new Map<string, number>();
  private timeoutHandle: NodeJS.Timeout | null = null;
  private running = false;
  private activeRunId: string | null = null;
  private lastTickStartedAt: string | null = null;
  private lastTickCompletedAt: string | null = null;
  private lastError: string | null = null;

  constructor(params: {
    config: AppConfig;
    db: MedvedssonDatabase;
    marketData?: MarketDataClient;
    notifications: NotificationService;
    logger: LoggerLike;
    executionAdapter?: ExecutionAdapter;
  }) {
    this.config = params.config;
    this.db = params.db;
    this.marketDataOverride = params.marketData ?? null;
    this.notifications = params.notifications;
    this.logger = params.logger;
    this.executionAdapterOverride = params.executionAdapter ?? null;
  }

  async init(): Promise<void> {
    await this.db.ensureDefaultSymbols(
      this.config.defaultSymbols,
      this.config.defaultSymbolSettings
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

    const activeSymbols = (await this.db.listSymbols()).filter(
      (symbol) => symbol.active
    );
    const run = await this.db.startRun(this.config, activeSymbols);
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

  private getSymbolSettings(symbol: SymbolRecord): SymbolRuntimeSettings {
    return {
      exchange: symbol.exchange,
      exchangeTimeoutMs: symbol.exchange_timeout_ms,
      exchangeRateLimitMs: symbol.exchange_rate_limit_ms,
      timeframe: symbol.timeframe,
      dryRun: symbol.dry_run,
      allowShort: symbol.allow_short,
      strategyKey: symbol.strategy_key,
      strategyVersion: symbol.strategy_version,
      signal: {
        n: symbol.signal_n,
        k: symbol.signal_k,
        hBars: symbol.signal_h_bars,
        timeframe: symbol.timeframe,
      },
      execution: {
        fillModel: symbol.fill_model,
        positionSizingMode: symbol.position_sizing_mode,
        feeRate: symbol.fee_rate,
        slippageBps: symbol.slippage_bps,
        fixedUsdtPerTrade: symbol.fixed_usdt_per_trade,
        equityStartUsdt: symbol.equity_start_usdt,
      },
      maxOpenPositions: symbol.max_open_positions,
      cooldownBars: symbol.cooldown_bars,
      maxDailyDrawdownPct: symbol.max_daily_drawdown_pct,
      maxConsecutiveLosses: symbol.max_consecutive_losses,
      pollIntervalMs: symbol.poll_interval_ms,
    };
  }

  private getExecutionAdapter(symbol: SymbolRecord): ExecutionAdapter {
    if (this.executionAdapterOverride) {
      return this.executionAdapterOverride;
    }

    return new DryRunExecutionAdapter(
      this.db,
      this.getSymbolSettings(symbol).execution
    );
  }

  private getMarketData(symbol: SymbolRecord): MarketDataClient {
    if (this.marketDataOverride) {
      return this.marketDataOverride;
    }

    const settings = this.getSymbolSettings(symbol);
    const key = `${settings.exchange}:${settings.exchangeTimeoutMs}:${settings.exchangeRateLimitMs}`;
    const existing = this.marketDataAdapters.get(key);

    if (existing) {
      return existing;
    }

    const adapter = new MarketDataAdapter(
      {
        exchange: settings.exchange,
        timeoutMs: settings.exchangeTimeoutMs,
        rateLimitMs: settings.exchangeRateLimitMs,
      },
      this.logger
    );

    this.marketDataAdapters.set(key, adapter);
    return adapter;
  }

  private scheduleNextTick(activeSymbols: SymbolRecord[] = []): void {
    if (!this.running) {
      return;
    }

    const now = Date.now();
    const delays =
      activeSymbols.length === 0
        ? [this.config.defaultSymbolSettings.pollIntervalMs]
        : activeSymbols.map((symbol) => {
            const lastPolledAt = this.lastPolledAtBySymbolId.get(symbol.id);

            if (lastPolledAt === undefined) {
              return 0;
            }

            return Math.max(0, symbol.poll_interval_ms - (now - lastPolledAt));
          });
    const nextDelay = Math.max(100, Math.min(...delays));

    this.timeoutHandle = setTimeout(() => {
      void this.tick();
    }, nextDelay);
  }

  private computeCooldownRemainingBars(
    lastExitTime: string | null,
    currentCloseTime: string,
    symbol: SymbolRecord
  ): number {
    if (!lastExitTime) {
      return 0;
    }

    const settings = this.getSymbolSettings(symbol);

    const elapsedBars = Math.floor(
      (new Date(currentCloseTime).getTime() -
        new Date(lastExitTime).getTime()) /
        timeframeToMs(settings.timeframe)
    );

    return Math.max(0, settings.cooldownBars - elapsedBars);
  }

  private async recordEquity(
    runId: string,
    snapshotTime: string,
    activeSymbols: SymbolRecord[]
  ): Promise<void> {
    const openPositions = await this.db.getOpenPositionsCount(runId);
    const unrealizedPnl = await this.db.computeUnrealizedPnl(runId);
    const realizedPnlCum = await this.db.getRealizedPnlCum(runId);
    const startingEquity = activeSymbols.reduce(
      (sum, symbol) => sum + symbol.equity_start_usdt,
      0
    );
    const balanceUsdt = round(startingEquity + realizedPnlCum, 8);
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
    symbol: SymbolRecord,
    candle: Candle
  ): Promise<void> {
    await this.getExecutionAdapter(symbol).processPendingFills({
      runId,
      symbolId: symbol.id,
      openPrice: candle.open,
      openTime: candle.openTime,
    });
  }

  private async finalizeProcessedCandle(
    runId: string,
    symbol: SymbolRecord,
    candle: Candle,
    activeSymbols: SymbolRecord[]
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

    await this.recordEquity(runId, candle.closeTime, activeSymbols);
  }

  private async processCandle(
    runId: string,
    symbol: SymbolRecord,
    candle: Candle,
    history: Candle[],
    activeSymbols: SymbolRecord[]
  ): Promise<void> {
    const settings = this.getSymbolSettings(symbol);

    await this.processPendingOrders(runId, symbol, candle);

    const openPosition = await this.db.getOpenPosition(runId, symbol.id);
    const signal = evaluateMomentumStrategy(
      history,
      settings.signal,
      openPosition
    );

    if (signal.signalType === SIGNAL_TYPES.NO_SIGNAL) {
      await this.db.recordProcessedCandle({
        runId,
        symbolId: symbol.id,
        candleCloseTime: signal.candleCloseTime,
      });
      await this.finalizeProcessedCandle(runId, symbol, candle, activeSymbols);
      return;
    }

    const signalRow = await this.db.insertSignal({
      runId,
      symbolId: symbol.id,
      exchange: symbol.exchange,
      symbol: symbol.symbol,
      timeframe: symbol.timeframe,
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
      candle.closeTime,
      symbol
    );

    const decision = evaluateRisk({
      signal,
      symbolEnabled: symbol.active,
      enoughHistory: history.length >= requiredCandles(settings.signal),
      allowShort: settings.allowShort,
      maxOpenPositions: settings.maxOpenPositions,
      openPositionsCount: await this.db.getOpenPositionsCount(runId),
      openPosition,
      cooldownRemainingBars,
      currentDrawdownPct: await this.db.getCurrentDrawdownPct(runId),
      maxDailyDrawdownPct: settings.maxDailyDrawdownPct,
      consecutiveLosses: await this.db.getConsecutiveLosses(runId),
      maxConsecutiveLosses: settings.maxConsecutiveLosses,
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
      const executionResult = await this.getExecutionAdapter(
        symbol
      ).handleApprovedSignal({
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
        strategyVersion: settings.strategyVersion,
        reason: signal.reason,
        approved: true,
        referencePrice: candle.close,
      });
    } else {
      await this.notifications.notifySignal({
        symbol: symbol.symbol,
        signalType: signal.signalType,
        signalTime: signal.candleCloseTime,
        strategyVersion: settings.strategyVersion,
        reason: decision.rejectionReason ?? signal.reason,
        approved: false,
        referencePrice: candle.close,
      });
    }

    await this.finalizeProcessedCandle(runId, symbol, candle, activeSymbols);
  }

  private async processSymbol(
    runId: string,
    symbol: SymbolRecord,
    activeSymbols: SymbolRecord[]
  ): Promise<void> {
    const settings = this.getSymbolSettings(symbol);
    const historyLimit = Math.max(
      settings.signal.n + settings.signal.hBars + 8,
      192
    );
    const cachedCandles = this.config.enableCandleStorage
      ? await this.db.getRecentCandles(
          symbol.exchange,
          symbol.symbol,
          symbol.timeframe,
          historyLimit
        )
      : [];
    let exchangeCandles: Candle[] = [];
    let usedCacheFallback = false;
    const startedAt = Date.now();

    try {
      exchangeCandles = await this.getMarketData(symbol).fetchRecentCandles(
        symbol.symbol,
        symbol.timeframe,
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
      symbol.timeframe
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
    const combinedDiagnostics = analyzeCandleSeries(candles, symbol.timeframe);

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

      await this.processCandle(
        runId,
        symbol,
        candidate,
        history,
        activeSymbols
      );
    }
  }

  async tick(): Promise<void> {
    if (!this.running || !this.activeRunId) {
      return;
    }

    this.lastTickStartedAt = new Date().toISOString();
    this.lastError = null;
    let activeSymbols: SymbolRecord[] = [];

    try {
      activeSymbols = (await this.db.listSymbols()).filter(
        (symbol) => symbol.active
      );
      const now = Date.now();
      const dueSymbols = activeSymbols.filter((symbol) => {
        const lastPolledAt = this.lastPolledAtBySymbolId.get(symbol.id);

        return (
          lastPolledAt === undefined ||
          now - lastPolledAt >= symbol.poll_interval_ms
        );
      });

      for (const symbol of dueSymbols) {
        this.lastPolledAtBySymbolId.set(symbol.id, Date.now());
        await this.processSymbol(this.activeRunId, symbol, activeSymbols);
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
      this.scheduleNextTick(activeSymbols);
    }
  }
}

export * from './metrics.ts';
