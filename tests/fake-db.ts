import { randomUUID } from 'node:crypto';

import {
  calculateTradePnl,
  calculateUnrealizedPnl,
} from '@medvedsson/execution';
import type {
  AppConfig,
  Candle,
  OpenPositionContext,
  PushSubscriptionRecord,
  RiskDecision,
  StrategySignal,
} from '@medvedsson/shared';
import { round, SIGNAL_TYPES } from '@medvedsson/shared';

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
  exchange: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
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
};

type SimulatedOrderRow = {
  id: string;
  strategy_run_id: string;
  position_id: string | null;
  signal_id: string;
  symbol_id: string;
  order_type: string;
  side: 'BUY' | 'SELL';
  intent: 'OPEN_POSITION' | 'CLOSE_POSITION';
  reference_price: number;
  fill_price: number | null;
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

type PushSubscriptionRow = PushSubscriptionRecord & {
  id: string;
  created_at: Date;
  updated_at: Date;
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

  async startRun(config: AppConfig): Promise<RunRow> {
    const current = await this.getActiveRun();

    if (current) {
      return current;
    }

    return this.createRun({
      name: `${config.strategyKey}-${config.strategyVersion}-${new Date().toISOString()}`,
      strategyKey: config.strategyKey,
      version: config.strategyVersion,
      timeframe: config.timeframe,
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

  async replaceActiveSymbols(
    exchange: string,
    symbols: string[]
  ): Promise<SymbolRow[]> {
    for (const symbol of this.symbols) {
      if (symbol.exchange === exchange) {
        symbol.active = false;
        symbol.updated_at = new Date();
      }
    }

    const results: SymbolRow[] = [];

    for (const symbol of symbols) {
      const [baseAsset, quoteAsset] = symbol.split('/');
      let row = this.symbols.find(
        (item) => item.exchange === exchange && item.symbol === symbol
      );

      if (!row) {
        row = {
          id: randomUUID(),
          exchange,
          symbol,
          base_asset: baseAsset!,
          quote_asset: quoteAsset!,
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
        this.symbols.push(row);
      } else {
        row.base_asset = baseAsset!;
        row.quote_asset = quoteAsset!;
        row.active = true;
        row.updated_at = new Date();
      }

      results.push(row);
    }

    return results;
  }

  async listSymbols(): Promise<SymbolRow[]> {
    return [...this.symbols].sort((left, right) =>
      left.symbol.localeCompare(right.symbol)
    );
  }

  async getSymbol(exchange: string, symbol: string): Promise<SymbolRow | null> {
    return (
      this.symbols.find(
        (item) => item.exchange === exchange && item.symbol === symbol
      ) ?? null
    );
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

  async getDailyRealizedPnl(runId: string, isoTime: string): Promise<number> {
    const day = isoTime.slice(0, 10);

    return this.positions
      .filter(
        (item) =>
          item.strategy_run_id === runId &&
          item.status === 'CLOSED' &&
          item.exit_time?.toISOString().slice(0, 10) === day
      )
      .reduce((sum, item) => sum + (item.realized_pnl ?? 0), 0);
  }

  async createPendingOrder(params: {
    runId: string;
    signalId: string;
    symbolId: string;
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
      order_type: params.orderType,
      side: params.side,
      intent: params.intent,
      reference_price: params.referencePrice,
      fill_price: null,
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

    order.fill_price = fillPrice;
    order.status = 'FILLED';

    if (order.intent === 'OPEN_POSITION') {
      this.positions.push({
        id: randomUUID(),
        strategy_run_id: order.strategy_run_id,
        symbol_id: order.symbol_id,
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
      existing.symbolFilters = subscription.symbolFilters;
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
    symbol: string,
    eventType: string
  ): Promise<PushSubscriptionRow[]> {
    return this.pushSubscriptions.filter((subscription) => {
      const symbolMatch =
        subscription.symbolFilters === null ||
        subscription.symbolFilters.length === 0 ||
        subscription.symbolFilters.includes(symbol);
      const eventMatch =
        subscription.eventFilters === null ||
        subscription.eventFilters.length === 0 ||
        subscription.eventFilters.includes(eventType);

      return subscription.enabled && symbolMatch && eventMatch;
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
