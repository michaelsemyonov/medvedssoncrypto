import { randomUUID } from 'node:crypto';

import {
  calculateTradePnl,
  calculateUnrealizedPnl,
} from '@medvedsson/execution';
import type {
  AppConfig,
  BrokerName,
  Candle,
  ExchangeName,
  OpenPositionContext,
  PushSubscriptionRecord,
  RiskDecision,
  StrategySignal,
  SymbolRuntimeSettings,
  Timeframe,
} from '@medvedsson/shared';
import {
  DEFAULT_SYMBOL_SETTINGS,
  normalizeSymbol,
  round,
  SIGNAL_TYPES,
} from '@medvedsson/shared';

type RunRow = {
  id: string;
  name: string;
  strategy_key: string;
  version: string;
  timeframe: string;
  status: string;
  dry_run: boolean;
  base_currency: string;
  started_at: Date;
  stopped_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type SymbolRow = {
  id: string;
  exchange: ExchangeName;
  exchange_timeout_ms: number;
  exchange_rate_limit_ms: number;
  position_broker: BrokerName;
  counter_position_broker: BrokerName;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  timeframe: Timeframe;
  dry_run: boolean;
  allow_short: boolean;
  strategy_key: string;
  strategy_version: string;
  signal_n: number;
  signal_k: number;
  signal_h_bars: number;
  fill_model: 'next_open';
  fee_rate: number;
  slippage_bps: number;
  position_sizing_mode: 'fixed_usdt';
  fixed_usdt_per_trade: number;
  equity_start_usdt: number;
  max_open_positions: number;
  cooldown_bars: number;
  stop_loss_pct: number;
  max_daily_drawdown_pct: number;
  max_consecutive_losses: number;
  poll_interval_ms: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type SymbolUpsertParams = SymbolRuntimeSettings & {
  symbol: string;
  active: boolean;
};

type SignalRow = {
  id: string;
  strategy_run_id: string;
  symbol_id: string;
  exchange: string;
  symbol: string;
  timeframe: string;
  candle_close_time: Date;
  signal_type: string;
  signal_strength: number | null;
  formula_inputs: Record<string, unknown>;
  indicators: Record<string, unknown>;
  features: Record<string, unknown>;
  reason: string;
  approved: boolean | null;
  rejection_reason: string | null;
  idempotency_key: string;
  created_at: Date;
};

type SignalWithCandlesRow = SignalRow & {
  recent_candles: Candle[];
};

type PositionRow = {
  id: string;
  strategy_run_id: string;
  symbol_id: string;
  broker: BrokerName;
  is_counter_position: boolean;
  side: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED';
  entry_time: Date;
  exit_time: Date | null;
  entry_price: number;
  exit_price: number | null;
  qty: number;
  notional_usdt: number;
  entry_fee: number;
  exit_fee: number | null;
  realized_pnl: number | null;
  opened_by_signal_id: string;
  closed_by_signal_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type RecentTradeRow = PositionRow & {
  symbol: string;
  opened_at: Date;
  opening_order_created_at: Date;
  opening_order_filled_at: Date | null;
};

type SimulatedOrderRow = {
  id: string;
  strategy_run_id: string;
  position_id: string | null;
  signal_id: string;
  symbol_id: string;
  broker: BrokerName;
  order_type: string;
  side: 'BUY' | 'SELL';
  intent: 'OPEN_POSITION' | 'CLOSE_POSITION';
  reference_price: number;
  fill_price: number | null;
  filled_at: Date | null;
  qty: number;
  notional_usdt: number;
  slippage_bps: number;
  fee_rate: number;
  fee_amount: number;
  fill_model: string;
  status: 'PENDING' | 'FILLED' | 'CANCELLED';
  meta: Record<string, unknown>;
  created_at: Date;
};

type EquitySnapshot = {
  id: string;
  strategy_run_id: string;
  snapshot_time: Date;
  balance_usdt: number;
  equity_usdt: number;
  unrealized_pnl: number;
  realized_pnl_cum: number;
  drawdown_pct: number;
  open_positions: number;
};

type RunSymbolProgressRow = {
  strategy_run_id: string;
  symbol_id: string;
  last_processed_close_time: Date;
  created_at: Date;
  updated_at: Date;
};

const normalizeSymbolSettings = (
  settings: Partial<SymbolRuntimeSettings> = {}
): SymbolRuntimeSettings => ({
  exchange: settings.exchange ?? DEFAULT_SYMBOL_SETTINGS.exchange,
  exchangeTimeoutMs:
    settings.exchangeTimeoutMs ?? DEFAULT_SYMBOL_SETTINGS.exchangeTimeoutMs,
  exchangeRateLimitMs:
    settings.exchangeRateLimitMs ?? DEFAULT_SYMBOL_SETTINGS.exchangeRateLimitMs,
  positionBroker:
    settings.positionBroker ?? DEFAULT_SYMBOL_SETTINGS.positionBroker,
  counterPositionBroker:
    settings.counterPositionBroker ??
    DEFAULT_SYMBOL_SETTINGS.counterPositionBroker,
  timeframe: settings.timeframe ?? DEFAULT_SYMBOL_SETTINGS.timeframe,
  dryRun: settings.dryRun ?? DEFAULT_SYMBOL_SETTINGS.dryRun,
  allowShort: settings.allowShort ?? DEFAULT_SYMBOL_SETTINGS.allowShort,
  strategyKey: settings.strategyKey ?? DEFAULT_SYMBOL_SETTINGS.strategyKey,
  strategyVersion:
    settings.strategyVersion ?? DEFAULT_SYMBOL_SETTINGS.strategyVersion,
  signal: {
    n: settings.signal?.n ?? DEFAULT_SYMBOL_SETTINGS.signal.n,
    k: settings.signal?.k ?? DEFAULT_SYMBOL_SETTINGS.signal.k,
    hBars: settings.signal?.hBars ?? DEFAULT_SYMBOL_SETTINGS.signal.hBars,
    timeframe:
      settings.signal?.timeframe ??
      settings.timeframe ??
      DEFAULT_SYMBOL_SETTINGS.signal.timeframe,
  },
  execution: {
    fillModel:
      settings.execution?.fillModel ??
      DEFAULT_SYMBOL_SETTINGS.execution.fillModel,
    positionSizingMode:
      settings.execution?.positionSizingMode ??
      DEFAULT_SYMBOL_SETTINGS.execution.positionSizingMode,
    feeRate:
      settings.execution?.feeRate ?? DEFAULT_SYMBOL_SETTINGS.execution.feeRate,
    slippageBps:
      settings.execution?.slippageBps ??
      DEFAULT_SYMBOL_SETTINGS.execution.slippageBps,
    fixedUsdtPerTrade:
      settings.execution?.fixedUsdtPerTrade ??
      DEFAULT_SYMBOL_SETTINGS.execution.fixedUsdtPerTrade,
    equityStartUsdt:
      settings.execution?.equityStartUsdt ??
      DEFAULT_SYMBOL_SETTINGS.execution.equityStartUsdt,
  },
  maxOpenPositions:
    settings.maxOpenPositions ?? DEFAULT_SYMBOL_SETTINGS.maxOpenPositions,
  cooldownBars: settings.cooldownBars ?? DEFAULT_SYMBOL_SETTINGS.cooldownBars,
  stopLossPct: settings.stopLossPct ?? DEFAULT_SYMBOL_SETTINGS.stopLossPct,
  trailingProfile:
    settings.trailingProfile ?? DEFAULT_SYMBOL_SETTINGS.trailingProfile,
  trailingEnabled:
    settings.trailingEnabled ?? DEFAULT_SYMBOL_SETTINGS.trailingEnabled,
  trailingActivationProfitPct:
    settings.trailingActivationProfitPct ??
    DEFAULT_SYMBOL_SETTINGS.trailingActivationProfitPct,
  trailingGivebackRatio:
    settings.trailingGivebackRatio ??
    DEFAULT_SYMBOL_SETTINGS.trailingGivebackRatio,
  trailingGivebackMinPct:
    settings.trailingGivebackMinPct ??
    DEFAULT_SYMBOL_SETTINGS.trailingGivebackMinPct,
  trailingGivebackMaxPct:
    settings.trailingGivebackMaxPct ??
    DEFAULT_SYMBOL_SETTINGS.trailingGivebackMaxPct,
  trailingMinLockedProfitPct:
    settings.trailingMinLockedProfitPct ??
    DEFAULT_SYMBOL_SETTINGS.trailingMinLockedProfitPct,
  maxDailyDrawdownPct:
    settings.maxDailyDrawdownPct ?? DEFAULT_SYMBOL_SETTINGS.maxDailyDrawdownPct,
  maxConsecutiveLosses:
    settings.maxConsecutiveLosses ??
    DEFAULT_SYMBOL_SETTINGS.maxConsecutiveLosses,
  pollIntervalMs:
    settings.pollIntervalMs ?? DEFAULT_SYMBOL_SETTINGS.pollIntervalMs,
});

type PushSubscriptionRow = PushSubscriptionRecord & {
  id: string;
  created_at: Date;
  updated_at: Date;
  symbolFilters?: string[] | null;
};

const compareClosedPositionsDesc = (
  left: Pick<RecentTradeRow, 'opened_at' | 'updated_at' | 'created_at'>,
  right: Pick<RecentTradeRow, 'opened_at' | 'updated_at' | 'created_at'>
): number => {
  const openedAtDiff = right.opened_at.getTime() - left.opened_at.getTime();

  if (openedAtDiff !== 0) {
    return openedAtDiff;
  }

  const updatedAtDiff = right.updated_at.getTime() - left.updated_at.getTime();

  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  return right.created_at.getTime() - left.created_at.getTime();
};

const resolveTradeOpenedAt = (
  position: PositionRow,
  openingSignalTime: Date | null
): Date =>
  openingSignalTime !== null &&
  openingSignalTime.getTime() > position.entry_time.getTime()
    ? openingSignalTime
    : position.entry_time;

export class FakeMedvedssonDatabase {
  private runs: RunRow[] = [];
  private symbols: SymbolRow[] = [];
  private candles: Candle[] = [];
  private signals: SignalRow[] = [];
  private riskEvents: Array<{
    id: string;
    strategy_run_id: string;
    signal_id: string;
    symbol_id: string;
    approved: boolean;
    reason_code: string | null;
    reason_text: string | null;
    snapshot: Record<string, unknown>;
    created_at: Date;
  }> = [];
  private positions: PositionRow[] = [];
  private simulatedOrders: SimulatedOrderRow[] = [];
  private equitySnapshots: EquitySnapshot[] = [];
  private runSymbolProgress: RunSymbolProgressRow[] = [];
  private pushSubscriptions: PushSubscriptionRow[] = [];

  async migrate(): Promise<void> {}

  async close(): Promise<void> {}

  async getActiveRun(): Promise<RunRow | null> {
    return this.runs.find((run) => run.status === 'RUNNING') ?? null;
  }

  async listRuns(): Promise<RunRow[]> {
    return [...this.runs].sort(
      (left, right) => right.created_at.getTime() - left.created_at.getTime()
    );
  }

  async createRun(params: {
    name: string;
    strategyKey: string;
    version: string;
    timeframe: string;
    status?: string;
    dryRun?: boolean;
    baseCurrency?: string;
    startedAt?: string | Date;
  }): Promise<RunRow> {
    const now = params.startedAt ? new Date(params.startedAt) : new Date();
    const run: RunRow = {
      id: randomUUID(),
      name: params.name,
      strategy_key: params.strategyKey,
      version: params.version,
      timeframe: params.timeframe,
      status: params.status ?? 'RUNNING',
      dry_run: params.dryRun ?? true,
      base_currency: params.baseCurrency ?? 'USDT',
      started_at: now,
      stopped_at: null,
      created_at: now,
      updated_at: now,
    };

    this.runs.push(run);
    return run;
  }

  async startRun(
    config: AppConfig,
    activeSymbols: SymbolRow[] = []
  ): Promise<RunRow> {
    const current = await this.getActiveRun();

    if (current) {
      return current;
    }

    const baseline =
      activeSymbols[0] === undefined
        ? config.defaultSymbolSettings
        : normalizeSymbolSettings({
            exchange: activeSymbols[0].exchange,
            exchangeTimeoutMs: activeSymbols[0].exchange_timeout_ms,
            exchangeRateLimitMs: activeSymbols[0].exchange_rate_limit_ms,
            positionBroker: activeSymbols[0].position_broker,
            counterPositionBroker: activeSymbols[0].counter_position_broker,
            timeframe: activeSymbols[0].timeframe,
            dryRun: activeSymbols[0].dry_run,
            allowShort: activeSymbols[0].allow_short,
            strategyKey: activeSymbols[0].strategy_key,
            strategyVersion: activeSymbols[0].strategy_version,
            signal: {
              n: activeSymbols[0].signal_n,
              k: activeSymbols[0].signal_k,
              hBars: activeSymbols[0].signal_h_bars,
              timeframe: activeSymbols[0].timeframe,
            },
            execution: {
              fillModel: activeSymbols[0].fill_model,
              positionSizingMode: activeSymbols[0].position_sizing_mode,
              feeRate: activeSymbols[0].fee_rate,
              slippageBps: activeSymbols[0].slippage_bps,
              fixedUsdtPerTrade: activeSymbols[0].fixed_usdt_per_trade,
              equityStartUsdt: activeSymbols[0].equity_start_usdt,
            },
            maxOpenPositions: activeSymbols[0].max_open_positions,
            cooldownBars: activeSymbols[0].cooldown_bars,
            stopLossPct: activeSymbols[0].stop_loss_pct,
            maxDailyDrawdownPct: activeSymbols[0].max_daily_drawdown_pct,
            maxConsecutiveLosses: activeSymbols[0].max_consecutive_losses,
            pollIntervalMs: activeSymbols[0].poll_interval_ms,
          });

    return this.createRun({
      name: `${baseline.strategyKey}-${baseline.strategyVersion}-${new Date().toISOString()}`,
      strategyKey: baseline.strategyKey,
      version: baseline.strategyVersion,
      timeframe: baseline.timeframe,
      dryRun: baseline.dryRun,
    });
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.find((item) => item.id === runId);

    if (run) {
      run.status = 'STOPPED';
      run.stopped_at = new Date();
      run.updated_at = new Date();
    }
  }

  private upsertSymbolRecord(params: SymbolUpsertParams): SymbolRow {
    const normalizedSymbol = normalizeSymbol(params.symbol);
    const settings = normalizeSymbolSettings({
      ...params,
      signal: {
        ...params.signal,
        timeframe: params.timeframe,
      },
    });
    const [baseAsset, quoteAsset] = normalizedSymbol.split('/');
    let row = this.symbols.find(
      (item) =>
        item.exchange === settings.exchange && item.symbol === normalizedSymbol
    );

    if (!row) {
      row = {
        id: randomUUID(),
        exchange: settings.exchange,
        exchange_timeout_ms: settings.exchangeTimeoutMs,
        exchange_rate_limit_ms: settings.exchangeRateLimitMs,
        position_broker: settings.positionBroker,
        counter_position_broker: settings.counterPositionBroker,
        symbol: normalizedSymbol,
        base_asset: baseAsset!,
        quote_asset: quoteAsset!,
        timeframe: settings.timeframe,
        dry_run: settings.dryRun,
        allow_short: settings.allowShort,
        strategy_key: settings.strategyKey,
        strategy_version: settings.strategyVersion,
        signal_n: settings.signal.n,
        signal_k: settings.signal.k,
        signal_h_bars: settings.signal.hBars,
        fill_model: settings.execution.fillModel,
        fee_rate: settings.execution.feeRate,
        slippage_bps: settings.execution.slippageBps,
        position_sizing_mode: settings.execution.positionSizingMode,
        fixed_usdt_per_trade: settings.execution.fixedUsdtPerTrade,
        equity_start_usdt: settings.execution.equityStartUsdt,
        max_open_positions: settings.maxOpenPositions,
        cooldown_bars: settings.cooldownBars,
        stop_loss_pct: settings.stopLossPct,
        max_daily_drawdown_pct: settings.maxDailyDrawdownPct,
        max_consecutive_losses: settings.maxConsecutiveLosses,
        poll_interval_ms: settings.pollIntervalMs,
        active: params.active,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.symbols.push(row);
      return row;
    }

    row.exchange = settings.exchange;
    row.exchange_timeout_ms = settings.exchangeTimeoutMs;
    row.exchange_rate_limit_ms = settings.exchangeRateLimitMs;
    row.position_broker = settings.positionBroker;
    row.counter_position_broker = settings.counterPositionBroker;
    row.symbol = normalizedSymbol;
    row.base_asset = baseAsset!;
    row.quote_asset = quoteAsset!;
    row.timeframe = settings.timeframe;
    row.dry_run = settings.dryRun;
    row.allow_short = settings.allowShort;
    row.strategy_key = settings.strategyKey;
    row.strategy_version = settings.strategyVersion;
    row.signal_n = settings.signal.n;
    row.signal_k = settings.signal.k;
    row.signal_h_bars = settings.signal.hBars;
    row.fill_model = settings.execution.fillModel;
    row.fee_rate = settings.execution.feeRate;
    row.slippage_bps = settings.execution.slippageBps;
    row.position_sizing_mode = settings.execution.positionSizingMode;
    row.fixed_usdt_per_trade = settings.execution.fixedUsdtPerTrade;
    row.equity_start_usdt = settings.execution.equityStartUsdt;
    row.max_open_positions = settings.maxOpenPositions;
    row.cooldown_bars = settings.cooldownBars;
    row.stop_loss_pct = settings.stopLossPct;
    row.max_daily_drawdown_pct = settings.maxDailyDrawdownPct;
    row.max_consecutive_losses = settings.maxConsecutiveLosses;
    row.poll_interval_ms = settings.pollIntervalMs;
    row.active = params.active;
    row.updated_at = new Date();
    return row;
  }

  async ensureDefaultSymbols(
    symbols: string[],
    settings: SymbolRuntimeSettings = DEFAULT_SYMBOL_SETTINGS
  ): Promise<SymbolRow[]> {
    if (this.symbols.length > 0) {
      return this.listSymbols();
    }

    await this.replaceActiveSymbols(settings.exchange, symbols, settings);
    return this.listSymbols();
  }

  async replaceActiveSymbols(
    exchange: ExchangeName,
    symbols: string[],
    settings: Partial<SymbolRuntimeSettings> = {}
  ): Promise<SymbolRow[]> {
    for (const symbol of this.symbols) {
      if (symbol.exchange === exchange) {
        symbol.active = false;
        symbol.updated_at = new Date();
      }
    }

    const results: SymbolRow[] = [];
    const normalizedSettings = normalizeSymbolSettings({
      ...settings,
      exchange,
    });

    for (const symbol of symbols) {
      results.push(
        this.upsertSymbolRecord({
          ...normalizedSettings,
          symbol,
          active: true,
        })
      );
    }

    return results;
  }

  async createSymbol(params: SymbolUpsertParams): Promise<SymbolRow> {
    return this.upsertSymbolRecord(params);
  }

  async listSymbols(): Promise<SymbolRow[]> {
    return [...this.symbols].sort((left, right) =>
      left.symbol.localeCompare(right.symbol)
    );
  }

  async getSymbol(
    exchange: ExchangeName,
    symbol: string
  ): Promise<SymbolRow | null> {
    return (
      this.symbols.find(
        (item) =>
          item.exchange === exchange && item.symbol === normalizeSymbol(symbol)
      ) ?? null
    );
  }

  async getSymbolById(id: string): Promise<SymbolRow | null> {
    return this.symbols.find((item) => item.id === id) ?? null;
  }

  async updateSymbol(
    id: string,
    params: SymbolUpsertParams
  ): Promise<SymbolRow> {
    const existing = await this.getSymbolById(id);

    if (!existing) {
      throw new Error(`Symbol ${id} was not found after update.`);
    }

    const normalizedSymbol = normalizeSymbol(params.symbol);
    const [baseAsset, quoteAsset] = normalizedSymbol.split('/');
    const settings = normalizeSymbolSettings({
      ...params,
      signal: {
        ...params.signal,
        timeframe: params.timeframe,
      },
    });

    existing.exchange = settings.exchange;
    existing.exchange_timeout_ms = settings.exchangeTimeoutMs;
    existing.exchange_rate_limit_ms = settings.exchangeRateLimitMs;
    existing.position_broker = settings.positionBroker;
    existing.counter_position_broker = settings.counterPositionBroker;
    existing.symbol = normalizedSymbol;
    existing.base_asset = baseAsset!;
    existing.quote_asset = quoteAsset!;
    existing.timeframe = settings.timeframe;
    existing.dry_run = settings.dryRun;
    existing.allow_short = settings.allowShort;
    existing.strategy_key = settings.strategyKey;
    existing.strategy_version = settings.strategyVersion;
    existing.signal_n = settings.signal.n;
    existing.signal_k = settings.signal.k;
    existing.signal_h_bars = settings.signal.hBars;
    existing.fill_model = settings.execution.fillModel;
    existing.fee_rate = settings.execution.feeRate;
    existing.slippage_bps = settings.execution.slippageBps;
    existing.position_sizing_mode = settings.execution.positionSizingMode;
    existing.fixed_usdt_per_trade = settings.execution.fixedUsdtPerTrade;
    existing.equity_start_usdt = settings.execution.equityStartUsdt;
    existing.max_open_positions = settings.maxOpenPositions;
    existing.cooldown_bars = settings.cooldownBars;
    existing.stop_loss_pct = settings.stopLossPct;
    existing.max_daily_drawdown_pct = settings.maxDailyDrawdownPct;
    existing.max_consecutive_losses = settings.maxConsecutiveLosses;
    existing.poll_interval_ms = settings.pollIntervalMs;
    existing.active = params.active;
    existing.updated_at = new Date();

    return existing;
  }

  async upsertCandles(candles: Candle[]): Promise<void> {
    for (const candle of candles) {
      const existing = this.candles.find(
        (item) =>
          item.exchange === candle.exchange &&
          item.symbol === candle.symbol &&
          item.timeframe === candle.timeframe &&
          item.closeTime === candle.closeTime
      );

      if (!existing) {
        this.candles.push(candle);
      }
    }
  }

  async getRecentCandles(
    exchange: string,
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<Candle[]> {
    return this.candles
      .filter(
        (item) =>
          item.exchange === exchange &&
          item.symbol === symbol &&
          item.timeframe === timeframe
      )
      .sort((left, right) => left.closeTime.localeCompare(right.closeTime))
      .slice(-limit);
  }

  async getCandlesInRange(params: {
    exchange: string;
    symbol: string;
    timeframe: string;
    startTime?: string | null;
    endTime?: string | null;
  }): Promise<Candle[]> {
    return this.candles
      .filter((item) => {
        if (
          item.exchange !== params.exchange ||
          item.symbol !== params.symbol ||
          item.timeframe !== params.timeframe
        ) {
          return false;
        }

        const closeTimeMs = new Date(item.closeTime).getTime();

        if (
          params.startTime &&
          closeTimeMs < new Date(params.startTime).getTime()
        ) {
          return false;
        }

        if (
          params.endTime &&
          closeTimeMs > new Date(params.endTime).getTime()
        ) {
          return false;
        }

        return true;
      })
      .sort((left, right) => left.closeTime.localeCompare(right.closeTime));
  }

  async getLastProcessedCloseTime(
    runId: string,
    symbolId: string
  ): Promise<string | null> {
    const progress = this.runSymbolProgress.find(
      (item) => item.strategy_run_id === runId && item.symbol_id === symbolId
    );

    if (progress) {
      return progress.last_processed_close_time.toISOString();
    }

    const row = this.signals
      .filter(
        (item) => item.strategy_run_id === runId && item.symbol_id === symbolId
      )
      .sort(
        (left, right) =>
          right.candle_close_time.getTime() - left.candle_close_time.getTime()
      )[0];

    return row ? row.candle_close_time.toISOString() : null;
  }

  async recordProcessedCandle(params: {
    runId: string;
    symbolId: string;
    candleCloseTime: string;
  }): Promise<void> {
    const existing = this.runSymbolProgress.find(
      (item) =>
        item.strategy_run_id === params.runId &&
        item.symbol_id === params.symbolId
    );
    const closeTime = new Date(params.candleCloseTime);

    if (existing) {
      existing.last_processed_close_time = closeTime;
      existing.updated_at = new Date();
      return;
    }

    this.runSymbolProgress.push({
      strategy_run_id: params.runId,
      symbol_id: params.symbolId,
      last_processed_close_time: closeTime,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  async insertSignal(params: {
    runId: string;
    symbolId: string;
    exchange: string;
    symbol: string;
    timeframe: string;
    signal: StrategySignal;
  }): Promise<SignalRow> {
    if (params.signal.signalType === SIGNAL_TYPES.NO_SIGNAL) {
      throw new Error('NO_SIGNAL must not be inserted into the signals table.');
    }

    const idempotencyKey = [
      params.runId,
      params.symbolId,
      params.signal.candleCloseTime,
      params.signal.signalType,
    ].join(':');
    const existing = this.signals.find(
      (item) => item.idempotency_key === idempotencyKey
    );

    if (existing) {
      return existing;
    }

    const row: SignalRow = {
      id: randomUUID(),
      strategy_run_id: params.runId,
      symbol_id: params.symbolId,
      exchange: params.exchange,
      symbol: params.symbol,
      timeframe: params.timeframe,
      candle_close_time: new Date(params.signal.candleCloseTime),
      signal_type: params.signal.signalType,
      signal_strength: params.signal.signalStrength,
      formula_inputs: params.signal.formulaInputs,
      indicators: params.signal.indicators,
      features: params.signal.features,
      reason: params.signal.reason,
      approved: null,
      rejection_reason: null,
      idempotency_key: idempotencyKey,
      created_at: new Date(),
    };

    this.signals.push(row);
    return row;
  }

  async updateSignalDecision(
    signalId: string,
    decision: RiskDecision
  ): Promise<void> {
    const signal = this.signals.find((item) => item.id === signalId);

    if (signal) {
      signal.approved = decision.approved;
      signal.rejection_reason = decision.rejectionReason;
    }
  }

  async insertRiskEvent(params: {
    runId: string;
    signalId: string;
    symbolId: string;
    decision: RiskDecision;
  }): Promise<void> {
    this.riskEvents.push({
      id: randomUUID(),
      strategy_run_id: params.runId,
      signal_id: params.signalId,
      symbol_id: params.symbolId,
      approved: params.decision.approved,
      reason_code: params.decision.rejectionCode,
      reason_text: params.decision.rejectionReason,
      snapshot: params.decision.snapshot,
      created_at: new Date(),
    });
  }

  async getOpenPosition(
    runId: string,
    symbolId: string
  ): Promise<OpenPositionContext | null> {
    const row = this.positions.find(
      (item) =>
        item.strategy_run_id === runId &&
        item.symbol_id === symbolId &&
        item.status === 'OPEN'
    );

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      side: row.side,
      entryTime: row.entry_time.toISOString(),
      entryPrice: row.entry_price,
      qty: row.qty,
      notionalUsdt: row.notional_usdt,
      entryFee: row.entry_fee,
      broker: row.broker,
      isCounterPosition: row.is_counter_position,
    };
  }

  async getOpenPositions(
    runId: string
  ): Promise<
    Array<PositionRow & { symbol: string; unrealized_pnl: number | null }>
  > {
    return Promise.all(
      this.positions
        .filter(
          (item) => item.strategy_run_id === runId && item.status === 'OPEN'
        )
        .map(async (position) => {
          const symbol =
            this.symbols.find((item) => item.id === position.symbol_id)
              ?.symbol ?? 'UNKNOWN';
          const latestClose = await this.getLatestClose(symbol);

          return {
            ...position,
            symbol,
            unrealized_pnl:
              latestClose === null
                ? null
                : calculateUnrealizedPnl(
                    {
                      side: position.side,
                      entryPrice: position.entry_price,
                      qty: position.qty,
                      entryFee: position.entry_fee,
                    },
                    latestClose
                  ),
          };
        })
    );
  }

  async getOpenPositionsCount(runId: string): Promise<number> {
    return this.positions.filter(
      (item) => item.strategy_run_id === runId && item.status === 'OPEN'
    ).length;
  }

  async getLastClosedPosition(
    runId: string,
    symbolId: string
  ): Promise<PositionRow | null> {
    return (
      this.positions
        .filter(
          (item) =>
            item.strategy_run_id === runId &&
            item.symbol_id === symbolId &&
            item.status === 'CLOSED'
        )
        .sort(
          (left, right) =>
            (right.exit_time?.getTime() ?? 0) - (left.exit_time?.getTime() ?? 0)
        )[0] ?? null
    );
  }

  async getConsecutiveLosses(runId: string): Promise<number> {
    const closed = this.positions
      .filter(
        (item) => item.strategy_run_id === runId && item.status === 'CLOSED'
      )
      .sort(
        (left, right) =>
          (right.exit_time?.getTime() ?? 0) - (left.exit_time?.getTime() ?? 0)
      );

    let losses = 0;

    for (const position of closed) {
      if ((position.realized_pnl ?? 0) < 0) {
        losses += 1;
        continue;
      }

      break;
    }

    return losses;
  }

  async getCurrentDrawdownPct(runId: string): Promise<number> {
    return (
      this.equitySnapshots
        .filter((item) => item.strategy_run_id === runId)
        .sort(
          (left, right) =>
            right.snapshot_time.getTime() - left.snapshot_time.getTime()
        )[0]?.drawdown_pct ?? 0
    );
  }

  async getRealizedPnlBetween(
    startTime: string,
    endTime: string,
    options: {
      isCounterPosition?: boolean;
      runId?: string | null;
    } = {}
  ): Promise<number> {
    const { isCounterPosition, runId = null } = options;
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    return this.positions
      .filter(
        (item) =>
          item.status === 'CLOSED' &&
          item.exit_time !== null &&
          item.exit_time.getTime() >= start &&
          item.exit_time.getTime() < end &&
          (runId === null || item.strategy_run_id === runId) &&
          (isCounterPosition === undefined ||
            item.is_counter_position === isCounterPosition)
      )
      .reduce((sum, item) => sum + (item.realized_pnl ?? 0), 0);
  }

  async createPendingOrder(params: {
    runId: string;
    signalId: string;
    symbolId: string;
    broker: BrokerName;
    orderType: string;
    side: 'BUY' | 'SELL';
    intent: 'OPEN_POSITION' | 'CLOSE_POSITION';
    referencePrice: number;
    qty: number;
    notionalUsdt: number;
    slippageBps: number;
    feeRate: number;
    feeAmount: number;
    fillModel: string;
    positionId?: string | null;
    meta: Record<string, unknown>;
  }): Promise<SimulatedOrderRow | null> {
    const existing = this.simulatedOrders.find(
      (item) =>
        item.signal_id === params.signalId && item.intent === params.intent
    );

    if (existing) {
      return null;
    }

    const order: SimulatedOrderRow = {
      id: randomUUID(),
      strategy_run_id: params.runId,
      position_id: params.positionId ?? null,
      signal_id: params.signalId,
      symbol_id: params.symbolId,
      broker: params.broker,
      order_type: params.orderType,
      side: params.side,
      intent: params.intent,
      reference_price: params.referencePrice,
      fill_price: null,
      filled_at: null,
      qty: params.qty,
      notional_usdt: params.notionalUsdt,
      slippage_bps: params.slippageBps,
      fee_rate: params.feeRate,
      fee_amount: params.feeAmount,
      fill_model: params.fillModel,
      status: 'PENDING',
      meta: params.meta,
      created_at: new Date(),
    };

    this.simulatedOrders.push(order);
    return order;
  }

  async getPendingOrdersForOpenTime(
    runId: string,
    symbolId: string,
    openTime: string
  ): Promise<SimulatedOrderRow[]> {
    return this.simulatedOrders.filter(
      (item) =>
        item.strategy_run_id === runId &&
        item.symbol_id === symbolId &&
        item.status === 'PENDING' &&
        item.meta.scheduled_for_open_time === openTime
    );
  }

  async fillPendingOrder(
    orderId: string,
    fillPrice: number,
    fillTime: string
  ): Promise<void> {
    const order = this.simulatedOrders.find((item) => item.id === orderId);

    if (!order || order.status !== 'PENDING') {
      return;
    }

    const recordedAt = new Date(fillTime);
    order.fill_price = fillPrice;
    order.filled_at = recordedAt;
    order.status = 'FILLED';

    if (order.intent === 'OPEN_POSITION') {
      this.positions.push({
        id: randomUUID(),
        strategy_run_id: order.strategy_run_id,
        symbol_id: order.symbol_id,
        broker: order.broker,
        is_counter_position: Boolean(order.meta.is_counter_position),
        side: order.side === 'BUY' ? 'LONG' : 'SHORT',
        status: 'OPEN',
        entry_time: new Date(fillTime),
        exit_time: null,
        entry_price: fillPrice,
        exit_price: null,
        qty: order.qty,
        notional_usdt: order.notional_usdt,
        entry_fee: order.fee_amount,
        exit_fee: null,
        realized_pnl: null,
        opened_by_signal_id: order.signal_id,
        closed_by_signal_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return;
    }

    const rawPositionId = order.meta.position_id ?? order.position_id;
    const positionId =
      typeof rawPositionId === 'string' || typeof rawPositionId === 'number'
        ? String(rawPositionId)
        : '';
    const position = this.positions.find((item) => item.id === positionId);

    if (!position || position.status !== 'OPEN') {
      return;
    }

    const pnl = calculateTradePnl(
      position.side,
      position.entry_price,
      fillPrice,
      position.qty,
      position.entry_fee,
      order.fee_amount
    );

    position.status = 'CLOSED';
    position.exit_time = new Date(fillTime);
    position.exit_price = fillPrice;
    position.exit_fee = order.fee_amount;
    position.realized_pnl = pnl.realizedPnl;
    position.closed_by_signal_id = order.signal_id;
    position.updated_at = new Date();
    order.position_id = position.id;
  }

  async recordEquitySnapshot(params: {
    runId: string;
    snapshotTime: string;
    balanceUsdt: number;
    equityUsdt: number;
    unrealizedPnl: number;
    realizedPnlCum: number;
    openPositions: number;
  }): Promise<void> {
    const peak = Math.max(
      params.equityUsdt,
      ...this.equitySnapshots
        .filter((item) => item.strategy_run_id === params.runId)
        .map((item) => item.equity_usdt)
    );

    this.equitySnapshots.push({
      id: randomUUID(),
      strategy_run_id: params.runId,
      snapshot_time: new Date(params.snapshotTime),
      balance_usdt: params.balanceUsdt,
      equity_usdt: params.equityUsdt,
      unrealized_pnl: params.unrealizedPnl,
      realized_pnl_cum: params.realizedPnlCum,
      drawdown_pct:
        peak === 0 ? 0 : round(((peak - params.equityUsdt) / peak) * 100, 8),
      open_positions: params.openPositions,
    });
  }

  async getRealizedPnlCum(runId: string): Promise<number> {
    return this.positions
      .filter(
        (item) => item.strategy_run_id === runId && item.status === 'CLOSED'
      )
      .reduce((sum, item) => sum + (item.realized_pnl ?? 0), 0);
  }

  async getRecentSignals(limit = 100): Promise<SignalRow[]> {
    return [...this.signals]
      .sort(
        (left, right) =>
          right.candle_close_time.getTime() - left.candle_close_time.getTime()
      )
      .slice(0, limit);
  }

  async getRecentSignalsWithCandles(
    limit = 100,
    offset = 0,
    candleCount = 12
  ): Promise<SignalWithCandlesRow[]> {
    return [...this.signals]
      .sort(
        (left, right) =>
          right.candle_close_time.getTime() - left.candle_close_time.getTime()
      )
      .slice(offset, offset + limit)
      .map((signal) => ({
        ...signal,
        recent_candles: this.candles
          .filter(
            (candle) =>
              candle.exchange === signal.exchange &&
              candle.symbol === signal.symbol &&
              candle.timeframe === signal.timeframe &&
              new Date(candle.closeTime).getTime() <=
                signal.candle_close_time.getTime()
          )
          .sort((left, right) => left.closeTime.localeCompare(right.closeTime))
          .slice(-candleCount),
      }));
  }

  async getRecentTrades(limit = 100): Promise<RecentTradeRow[]> {
    return this.positions
      .filter((item) => item.status === 'CLOSED')
      .map((position) => {
        const openingSignalTime =
          this.signals.find((item) => item.id === position.opened_by_signal_id)
            ?.candle_close_time ?? null;

        return {
          ...position,
          symbol:
            this.symbols.find((item) => item.id === position.symbol_id)
              ?.symbol ?? 'UNKNOWN',
          opened_at: resolveTradeOpenedAt(position, openingSignalTime),
          opening_order_created_at:
            this.simulatedOrders.find(
              (item) =>
                item.signal_id === position.opened_by_signal_id &&
                item.intent === 'OPEN_POSITION'
            )?.created_at ?? position.created_at,
          opening_order_filled_at:
            this.simulatedOrders.find(
              (item) =>
                item.signal_id === position.opened_by_signal_id &&
                item.intent === 'OPEN_POSITION'
            )?.filled_at ?? position.entry_time,
        };
      })
      .sort(compareClosedPositionsDesc)
      .slice(0, limit);
  }

  async getStatsSummary(
    runId: string | null,
    startingEquity: number
  ): Promise<Record<string, number>> {
    const closedTrades = this.positions.filter(
      (item) =>
        item.status === 'CLOSED' &&
        (runId === null || item.strategy_run_id === runId)
    );
    const wins = closedTrades.filter(
      (item) => (item.realized_pnl ?? 0) > 0
    ).length;
    const totalRealized = closedTrades.reduce(
      (sum, item) => sum + (item.realized_pnl ?? 0),
      0
    );
    const maxDrawdown = Math.max(
      0,
      ...this.equitySnapshots
        .filter((item) => runId === null || item.strategy_run_id === runId)
        .map((item) => item.drawdown_pct)
    );

    return {
      closedTrades: closedTrades.length,
      winRate:
        closedTrades.length === 0
          ? 0
          : round((wins / closedTrades.length) * 100, 4),
      averageTradeReturn:
        closedTrades.length === 0
          ? 0
          : closedTrades.reduce(
              (sum, item) =>
                sum +
                (item.realized_pnl ?? 0) / Math.max(item.notional_usdt, 1),
              0
            ) / closedTrades.length,
      totalRealizedPnl: totalRealized,
      equity: round(startingEquity + totalRealized, 8),
      maxDrawdownPct: maxDrawdown,
    };
  }

  async getLatestSignalsBySymbol(): Promise<
    Array<{
      symbol: string;
      signal_type: string;
      candle_close_time: Date;
      created_at: Date;
      approved: boolean | null;
    }>
  > {
    const latestBySymbol = new Map<string, SignalRow>();

    for (const signal of [...this.signals].sort(
      (left, right) =>
        right.candle_close_time.getTime() - left.candle_close_time.getTime()
    )) {
      if (!latestBySymbol.has(signal.symbol)) {
        latestBySymbol.set(signal.symbol, signal);
      }
    }

    return [...latestBySymbol.values()].map((signal) => ({
      symbol: signal.symbol,
      signal_type: signal.signal_type,
      candle_close_time: signal.candle_close_time,
      created_at: signal.created_at,
      approved: signal.approved,
    }));
  }

  async upsertPushSubscription(
    subscription: PushSubscriptionRecord
  ): Promise<void> {
    const existing = this.pushSubscriptions.find(
      (item) => item.endpoint === subscription.endpoint
    );

    if (existing) {
      existing.userLabel = subscription.userLabel;
      existing.p256dh = subscription.p256dh;
      existing.auth = subscription.auth;
      existing.enabled = subscription.enabled;
      existing.eventFilters = subscription.eventFilters;
      existing.updated_at = new Date();
      return;
    }

    this.pushSubscriptions.push({
      id: randomUUID(),
      ...subscription,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  async disablePushSubscription(endpoint: string): Promise<void> {
    const subscription = this.pushSubscriptions.find(
      (item) => item.endpoint === endpoint
    );

    if (subscription) {
      subscription.enabled = false;
      subscription.updated_at = new Date();
    }
  }

  async getPushSubscriptionsForEvent(
    _symbol: string,
    eventType: string
  ): Promise<PushSubscriptionRow[]> {
    return this.pushSubscriptions.filter((subscription) => {
      const eventMatch =
        subscription.eventFilters === null ||
        subscription.eventFilters.length === 0 ||
        subscription.eventFilters.includes(eventType);

      return subscription.enabled && eventMatch;
    });
  }

  private async getLatestClose(symbol: string): Promise<number | null> {
    const candle = [...this.candles]
      .filter((item) => item.symbol === symbol)
      .sort((left, right) => right.closeTime.localeCompare(left.closeTime))[0];

    return candle ? candle.close : null;
  }

  async computeUnrealizedPnl(runId: string): Promise<number> {
    const openPositions = this.positions.filter(
      (item) => item.strategy_run_id === runId && item.status === 'OPEN'
    );
    let total = 0;

    for (const position of openPositions) {
      const symbol = this.symbols.find(
        (item) => item.id === position.symbol_id
      )?.symbol;

      if (!symbol) {
        continue;
      }

      const latestClose = await this.getLatestClose(symbol);

      if (latestClose === null) {
        continue;
      }

      total += calculateUnrealizedPnl(
        {
          side: position.side,
          entryPrice: position.entry_price,
          qty: position.qty,
          entryFee: position.entry_fee,
        },
        latestClose
      );
    }

    return round(total, 8);
  }
}

export const createFakeDatabase = (): FakeMedvedssonDatabase =>
  new FakeMedvedssonDatabase();
