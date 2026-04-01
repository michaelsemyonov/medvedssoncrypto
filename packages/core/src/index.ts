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
  BrokerName,
  Candle,
  OpenPositionContext,
  RiskDecision,
  StrategySignal,
  SymbolRuntimeSettings,
} from '@medvedsson/shared';
import {
  getEntrySignalTypeForPositionSide,
  getExitSignalTypeForPositionSide,
  getOppositePositionSide,
  round,
  SIGNAL_TYPES,
  timeframeToMs,
} from '@medvedsson/shared';
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
      positionBroker: symbol.position_broker,
      counterPositionBroker: symbol.counter_position_broker,
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
      stopLossPct: symbol.stop_loss_pct,
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

  private buildApprovedDecision(
    signal: StrategySignal,
    snapshot: Record<string, unknown>
  ): RiskDecision {
    return {
      approved: true,
      rejectionCode: null,
      rejectionReason: null,
      snapshot,
    };
  }

  private buildStopLossSignal(params: {
    symbol: SymbolRecord;
    signalType: StrategySignal['signalType'];
    candleCloseTime: string;
    reason: string;
    comparison: 'LONG' | 'SHORT' | 'EXIT';
    triggerPrice: number;
    stopLossPct: number;
    broker: BrokerName;
    isCounterPosition: boolean;
  }): StrategySignal {
    return {
      signalType: params.signalType,
      candleCloseTime: params.candleCloseTime,
      signalStrength: 1,
      formulaInputs: {
        r_t: null,
        B_t: null,
        N: Number(params.symbol.signal_n),
        k: Number(params.symbol.signal_k),
        H: Number(params.symbol.signal_h_bars),
        threshold: params.triggerPrice,
        comparison: params.comparison,
      },
      indicators: {
        stopLossPrice: params.triggerPrice,
        stopLossPct: params.stopLossPct,
      },
      features: {
        source: 'stop_loss',
        broker: params.broker,
        isCounterPosition: params.isCounterPosition,
      },
      reason: params.reason,
    };
  }

  private async applySignal(params: {
    runId: string;
    symbol: SymbolRecord;
    candle: Candle;
    signal: StrategySignal;
    decision: RiskDecision;
    openPosition: OpenPositionContext | null;
    broker: BrokerName;
    isCounterPosition?: boolean;
    immediateFill?: {
      price: number;
      time: string;
    };
  }): Promise<void> {
    const settings = this.getSymbolSettings(params.symbol);
    const signalRow = await this.db.insertSignal({
      runId: params.runId,
      symbolId: params.symbol.id,
      exchange: params.symbol.exchange,
      symbol: params.symbol.symbol,
      timeframe: params.symbol.timeframe,
      signal: params.signal,
    });

    signalsCreatedCounter.inc({
      symbol: params.symbol.symbol,
      signal_type: params.signal.signalType,
    });

    await this.db.updateSignalDecision(signalRow.id, params.decision);
    await this.db.insertRiskEvent({
      runId: params.runId,
      signalId: signalRow.id,
      symbolId: params.symbol.id,
      decision: params.decision,
    });

    signalDecisionCounter.inc({
      symbol: params.symbol.symbol,
      approved: String(params.decision.approved),
    });

    if (params.decision.approved) {
      const executionResult = await this.getExecutionAdapter(
        params.symbol
      ).handleApprovedSignal({
        runId: params.runId,
        signalId: signalRow.id,
        symbolId: params.symbol.id,
        broker: params.broker,
        signalType: params.signal.signalType,
        referencePrice: params.candle.close,
        scheduledForOpenTime: params.candle.closeTime,
        openPosition: params.openPosition,
        isCounterPosition: params.isCounterPosition,
        immediateFill: params.immediateFill,
      });

      if (executionResult.orderCreated && executionResult.intent) {
        simulatedOrdersCounter.inc({
          symbol: params.symbol.symbol,
          intent: executionResult.intent,
        });
      }

      await this.notifications.notifySignal({
        symbol: params.symbol.symbol,
        signalType: params.signal.signalType,
        signalTime: params.signal.candleCloseTime,
        strategyVersion: settings.strategyVersion,
        reason: params.signal.reason,
        approved: true,
        referencePrice: params.candle.close,
      });

      return;
    }

    await this.notifications.notifySignal({
      symbol: params.symbol.symbol,
      signalType: params.signal.signalType,
      signalTime: params.signal.candleCloseTime,
      strategyVersion: settings.strategyVersion,
      reason: params.decision.rejectionReason ?? params.signal.reason,
      approved: false,
      referencePrice: params.candle.close,
    });
  }

  private resolveStopLoss(
    symbol: SymbolRecord,
    candle: Candle,
    openPosition: OpenPositionContext | null
  ): { triggerPrice: number; stopLossPct: number; usesEntryPrice: boolean } | null {
    if (!openPosition) {
      return null;
    }

    const settings = this.getSymbolSettings(symbol);

    if (openPosition.isCounterPosition) {
      const triggerPrice = round(openPosition.entryPrice, 8);

      if (openPosition.side === 'LONG') {
        return candle.low <= triggerPrice
          ? { triggerPrice, stopLossPct: 0, usesEntryPrice: true }
          : null;
      }

      return candle.high >= triggerPrice
        ? { triggerPrice, stopLossPct: 0, usesEntryPrice: true }
        : null;
    }

    if (settings.stopLossPct <= 0) {
      return null;
    }

    if (openPosition.side === 'LONG') {
      const triggerPrice = round(
        openPosition.entryPrice * (1 - settings.stopLossPct / 100),
        8
      );

      return candle.low <= triggerPrice
        ? { triggerPrice, stopLossPct: settings.stopLossPct, usesEntryPrice: false }
        : null;
    }

    const triggerPrice = round(
      openPosition.entryPrice * (1 + settings.stopLossPct / 100),
      8
    );

    return candle.high >= triggerPrice
      ? { triggerPrice, stopLossPct: settings.stopLossPct, usesEntryPrice: false }
      : null;
  }

  private async handleStopLoss(
    runId: string,
    symbol: SymbolRecord,
    candle: Candle,
    openPosition: OpenPositionContext,
    activeSymbols: SymbolRecord[]
  ): Promise<boolean> {
    const settings = this.getSymbolSettings(symbol);
    const stopLoss = this.resolveStopLoss(symbol, candle, openPosition);

    if (!stopLoss) {
      return false;
    }

    const closeSignal = this.buildStopLossSignal({
      symbol,
      signalType: getExitSignalTypeForPositionSide(openPosition.side),
      candleCloseTime: candle.closeTime,
      reason: stopLoss.usesEntryPrice
        ? `Stop loss hit at entry price ${stopLoss.triggerPrice}.`
        : `Stop loss hit at ${stopLoss.triggerPrice} (${stopLoss.stopLossPct}% from entry).`,
      comparison: 'EXIT',
      triggerPrice: stopLoss.triggerPrice,
      stopLossPct: stopLoss.stopLossPct,
      broker: openPosition.broker,
      isCounterPosition: openPosition.isCounterPosition,
    });
    const closeDecision = this.buildApprovedDecision(closeSignal, {
      source: 'stop_loss',
      broker: openPosition.broker,
      isCounterPosition: openPosition.isCounterPosition,
      triggerPrice: stopLoss.triggerPrice,
      stopLossPct: stopLoss.stopLossPct,
      usesEntryPrice: stopLoss.usesEntryPrice,
    });

    await this.applySignal({
      runId,
      symbol,
      candle: {
        ...candle,
        close: stopLoss.triggerPrice,
      },
      signal: closeSignal,
      decision: closeDecision,
      openPosition,
      broker: openPosition.broker,
      isCounterPosition: openPosition.isCounterPosition,
      immediateFill: {
        price: stopLoss.triggerPrice,
        time: candle.closeTime,
      },
    });

    if (!openPosition.isCounterPosition) {
      const counterSide = getOppositePositionSide(openPosition.side);
      const counterSignal = this.buildStopLossSignal({
        symbol,
        signalType: getEntrySignalTypeForPositionSide(counterSide),
        candleCloseTime: candle.closeTime,
        reason: `Counter position opened after stop loss at ${stopLoss.triggerPrice}.`,
        comparison: counterSide === 'LONG' ? 'LONG' : 'SHORT',
        triggerPrice: stopLoss.triggerPrice,
        stopLossPct: stopLoss.stopLossPct,
        broker: settings.counterPositionBroker,
        isCounterPosition: true,
      });
      const counterDecision = this.buildApprovedDecision(counterSignal, {
        source: 'stop_loss_counter',
        broker: settings.counterPositionBroker,
        isCounterPosition: true,
        triggerPrice: stopLoss.triggerPrice,
        stopLossPct: settings.stopLossPct,
      });

      await this.applySignal({
        runId,
        symbol,
        candle: {
          ...candle,
          close: stopLoss.triggerPrice,
        },
        signal: counterSignal,
        decision: counterDecision,
        openPosition: null,
        broker: settings.counterPositionBroker,
        isCounterPosition: true,
        immediateFill: {
          price: stopLoss.triggerPrice,
          time: candle.closeTime,
        },
      });
    }

    await this.db.recordProcessedCandle({
      runId,
      symbolId: symbol.id,
      candleCloseTime: candle.closeTime,
    });
    await this.finalizeProcessedCandle(runId, symbol, candle, activeSymbols);
    return true;
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

    if (
      openPosition &&
      (await this.handleStopLoss(
        runId,
        symbol,
        candle,
        openPosition,
        activeSymbols
      ))
    ) {
      return;
    }

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

    await this.db.recordProcessedCandle({
      runId,
      symbolId: symbol.id,
      candleCloseTime: signal.candleCloseTime,
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
    const broker =
      openPosition?.broker ??
      (signal.signalType === SIGNAL_TYPES.LONG_ENTRY ||
      signal.signalType === SIGNAL_TYPES.SHORT_ENTRY
        ? settings.positionBroker
        : settings.counterPositionBroker);

    await this.applySignal({
      runId,
      symbol,
      candle,
      signal,
      decision,
      openPosition,
      broker,
      isCounterPosition: openPosition?.isCounterPosition ?? false,
    });

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
