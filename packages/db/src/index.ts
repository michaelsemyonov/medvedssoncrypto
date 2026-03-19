import { randomUUID } from 'node:crypto';

import { calculateTradePnl } from '@medvedsson/execution';
import { adjustForSlippage, calculateUnrealizedPnl } from '@medvedsson/execution';
import type {
  AppConfig,
  Candle,
  OpenPositionContext,
  PushSubscriptionRecord,
  RiskDecision,
  StrategySignal
} from '@medvedsson/shared';
import { normalizeSymbol, round, utcDateKey } from '@medvedsson/shared';
import mysql from 'mysql2/promise';

import { MIGRATIONS } from './migrations.ts';

type Queryable = mysql.Pool | mysql.PoolConnection;
type MysqlRow = mysql.RowDataPacket & Record<string, unknown>;
type MysqlResult = mysql.ResultSetHeader;

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
  open_slot?: string | null;
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

type PushSubscriptionRow = {
  id: string;
  user_label: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
  symbol_filters: string[] | null;
  event_filters: string[] | null;
  created_at: Date;
  updated_at: Date;
};

export type DbPoolLike = mysql.Pool;

const toMysqlDateTime = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  return iso.slice(0, 23).replace('T', ' ');
};

const parseDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const text = String(value);

  if (text.endsWith('Z')) {
    return new Date(text);
  }

  if (text.includes('T')) {
    return new Date(`${text}Z`);
  }

  return new Date(text.replace(' ', 'T') + 'Z');
};

const parseJson = <T>(value: unknown): T => {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }

  return value as T;
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  return Boolean(value);
};

const query = async <TRow extends MysqlRow>(
  db: Queryable,
  text: string,
  params: unknown[] = []
): Promise<TRow[]> => {
  const [rows] = await db.query<TRow[]>(text, params);
  return rows;
};

const execute = async (db: Queryable, text: string, params: unknown[] = []): Promise<MysqlResult> => {
  const [result] = await db.execute<MysqlResult>(text, params as never);
  return result;
};

const withTransaction = async <T>(
  pool: DbPoolLike,
  fn: (client: mysql.PoolConnection) => Promise<T>
): Promise<T> => {
  const client = await pool.getConnection();

  try {
    await client.beginTransaction();
    const result = await fn(client);
    await client.commit();
    return result;
  } catch (error) {
    await client.rollback();
    throw error;
  } finally {
    client.release();
  }
};

const normalizeRunRow = (row: MysqlRow): RunRow => ({
  id: String(row.id),
  name: String(row.name),
  strategy_key: String(row.strategy_key),
  version: String(row.version),
  timeframe: String(row.timeframe),
  status: String(row.status),
  dry_run: parseBoolean(row.dry_run),
  base_currency: String(row.base_currency),
  started_at: parseDate(row.started_at)!,
  stopped_at: parseDate(row.stopped_at),
  created_at: parseDate(row.created_at)!,
  updated_at: parseDate(row.updated_at)!
});

const normalizeSymbolRow = (row: MysqlRow): SymbolRow => ({
  id: String(row.id),
  exchange: String(row.exchange),
  symbol: String(row.symbol),
  base_asset: String(row.base_asset),
  quote_asset: String(row.quote_asset),
  active: parseBoolean(row.active),
  created_at: parseDate(row.created_at)!,
  updated_at: parseDate(row.updated_at)!
});

const normalizeSignalRow = (row: MysqlRow): SignalRow => ({
  id: String(row.id),
  strategy_run_id: String(row.strategy_run_id),
  symbol_id: String(row.symbol_id),
  exchange: String(row.exchange),
  symbol: String(row.symbol),
  timeframe: String(row.timeframe),
  candle_close_time: parseDate(row.candle_close_time)!,
  signal_type: String(row.signal_type),
  signal_strength: row.signal_strength === null ? null : Number(row.signal_strength),
  formula_inputs: parseJson<Record<string, unknown>>(row.formula_inputs),
  indicators: parseJson<Record<string, unknown>>(row.indicators),
  features: parseJson<Record<string, unknown>>(row.features),
  reason: String(row.reason),
  approved: row.approved === null || row.approved === undefined ? null : parseBoolean(row.approved),
  rejection_reason: row.rejection_reason === null ? null : String(row.rejection_reason),
  idempotency_key: String(row.idempotency_key),
  created_at: parseDate(row.created_at)!
});

const normalizePositionRow = (row: MysqlRow): PositionRow => ({
  id: String(row.id),
  strategy_run_id: String(row.strategy_run_id),
  symbol_id: String(row.symbol_id),
  side: String(row.side) as PositionRow['side'],
  status: String(row.status) as PositionRow['status'],
  entry_time: parseDate(row.entry_time)!,
  exit_time: parseDate(row.exit_time),
  entry_price: Number(row.entry_price),
  exit_price: row.exit_price === null ? null : Number(row.exit_price),
  qty: Number(row.qty),
  notional_usdt: Number(row.notional_usdt),
  entry_fee: Number(row.entry_fee),
  exit_fee: row.exit_fee === null ? null : Number(row.exit_fee),
  realized_pnl: row.realized_pnl === null ? null : Number(row.realized_pnl),
  opened_by_signal_id: String(row.opened_by_signal_id),
  closed_by_signal_id: row.closed_by_signal_id === null ? null : String(row.closed_by_signal_id),
  created_at: parseDate(row.created_at)!,
  updated_at: parseDate(row.updated_at)!,
  open_slot: row.open_slot === null || row.open_slot === undefined ? null : String(row.open_slot)
});

const normalizeSimulatedOrderRow = (row: MysqlRow): SimulatedOrderRow => ({
  id: String(row.id),
  strategy_run_id: String(row.strategy_run_id),
  position_id: row.position_id === null ? null : String(row.position_id),
  signal_id: String(row.signal_id),
  symbol_id: String(row.symbol_id),
  order_type: String(row.order_type),
  side: String(row.side) as SimulatedOrderRow['side'],
  intent: String(row.intent) as SimulatedOrderRow['intent'],
  reference_price: Number(row.reference_price),
  fill_price: row.fill_price === null ? null : Number(row.fill_price),
  qty: Number(row.qty),
  notional_usdt: Number(row.notional_usdt),
  slippage_bps: Number(row.slippage_bps),
  fee_rate: Number(row.fee_rate),
  fee_amount: Number(row.fee_amount),
  fill_model: String(row.fill_model),
  status: String(row.status) as SimulatedOrderRow['status'],
  meta: parseJson<Record<string, unknown>>(row.meta),
  created_at: parseDate(row.created_at)!
});

const normalizePushSubscriptionRow = (row: MysqlRow): PushSubscriptionRow => ({
  id: String(row.id),
  user_label: row.user_label === null ? null : String(row.user_label),
  endpoint: String(row.endpoint),
  p256dh: String(row.p256dh),
  auth: String(row.auth),
  enabled: parseBoolean(row.enabled),
  symbol_filters:
    row.symbol_filters === null ? null : parseJson<string[]>(row.symbol_filters),
  event_filters:
    row.event_filters === null ? null : parseJson<string[]>(row.event_filters),
  created_at: parseDate(row.created_at)!,
  updated_at: parseDate(row.updated_at)!
});

export const createPool = (connectionString: string): DbPoolLike =>
  mysql.createPool({
    uri: connectionString,
    connectionLimit: 10,
    timezone: 'Z',
    multipleStatements: true,
    decimalNumbers: true,
    dateStrings: true
  });

export class MedvedssonDatabase {
  readonly pool: DbPoolLike;

  constructor(pool: DbPoolLike) {
    this.pool = pool;
  }

  async migrate(): Promise<void> {
    await execute(
      this.pool,
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id VARCHAR(128) PRIMARY KEY,
         run_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
       )`
    );

    for (const migration of MIGRATIONS) {
      const existing = await query<MysqlRow>(
        this.pool,
        'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
        [migration.id]
      );

      if (existing.length > 0) {
        continue;
      }

      await withTransaction(this.pool, async (client) => {
        await client.query(migration.sql);
        await execute(client, 'INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
      });
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getActiveRun(): Promise<RunRow | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM strategy_runs
       WHERE status = 'RUNNING'
       ORDER BY started_at DESC
       LIMIT 1`
    );

    return rows[0] ? normalizeRunRow(rows[0]) : null;
  }

  async listRuns(): Promise<RunRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM strategy_runs
       ORDER BY created_at DESC
       LIMIT 50`
    );

    return rows.map(normalizeRunRow);
  }

  async startRun(config: AppConfig): Promise<RunRow> {
    const current = await this.getActiveRun();

    if (current) {
      return current;
    }

    const now = new Date();
    const id = randomUUID();
    const name = `${config.strategyKey}-${config.strategyVersion}-${now.toISOString()}`;

    await execute(
      this.pool,
      `INSERT INTO strategy_runs (
         id, name, strategy_key, version, timeframe, status, dry_run, base_currency, started_at
       )
       VALUES (?, ?, ?, ?, ?, 'RUNNING', TRUE, 'USDT', ?)`,
      [id, name, config.strategyKey, config.strategyVersion, config.timeframe, toMysqlDateTime(now)]
    );

    const rows = await query<MysqlRow>(this.pool, 'SELECT * FROM strategy_runs WHERE id = ? LIMIT 1', [id]);
    return normalizeRunRow(rows[0]!);
  }

  async stopRun(runId: string): Promise<void> {
    await execute(
      this.pool,
      `UPDATE strategy_runs
       SET status = 'STOPPED', stopped_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [runId]
    );
  }

  async replaceActiveSymbols(exchange: string, symbols: string[]): Promise<SymbolRow[]> {
    await execute(
      this.pool,
      `UPDATE symbols SET active = FALSE, updated_at = CURRENT_TIMESTAMP(3) WHERE exchange = ?`,
      [exchange]
    );

    const results: SymbolRow[] = [];

    for (const symbol of symbols.map(normalizeSymbol)) {
      const [baseAsset, quoteAsset] = symbol.split('/');
      await execute(
        this.pool,
        `INSERT INTO symbols (id, exchange, symbol, base_asset, quote_asset, active)
         VALUES (?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE
           base_asset = VALUES(base_asset),
           quote_asset = VALUES(quote_asset),
           active = TRUE,
           updated_at = CURRENT_TIMESTAMP(3)`,
        [randomUUID(), exchange, symbol, baseAsset, quoteAsset]
      );

      const rows = await query<MysqlRow>(
        this.pool,
        'SELECT * FROM symbols WHERE exchange = ? AND symbol = ? LIMIT 1',
        [exchange, symbol]
      );

      results.push(normalizeSymbolRow(rows[0]!));
    }

    return results;
  }

  async listSymbols(): Promise<SymbolRow[]> {
    const rows = await query<MysqlRow>(this.pool, 'SELECT * FROM symbols ORDER BY symbol ASC');
    return rows.map(normalizeSymbolRow);
  }

  async getSymbol(exchange: string, symbol: string): Promise<SymbolRow | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM symbols WHERE exchange = ? AND symbol = ? LIMIT 1',
      [exchange, normalizeSymbol(symbol)]
    );

    return rows[0] ? normalizeSymbolRow(rows[0]) : null;
  }

  async upsertCandles(candles: Candle[]): Promise<void> {
    for (const candle of candles) {
      await execute(
        this.pool,
        `INSERT IGNORE INTO market_candles (
           id, exchange, symbol, timeframe, open_time, close_time, open, high, low, close, volume, source
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          candle.exchange,
          candle.symbol,
          candle.timeframe,
          toMysqlDateTime(candle.openTime),
          toMysqlDateTime(candle.closeTime),
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          candle.source
        ]
      );
    }
  }

  async getRecentCandles(exchange: string, symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT exchange, symbol, timeframe, open_time, close_time, open, high, low, close, volume, source
       FROM market_candles
       WHERE exchange = ? AND symbol = ? AND timeframe = ?
       ORDER BY close_time DESC
       LIMIT ?`,
      [exchange, normalizeSymbol(symbol), timeframe, limit]
    );

    return rows.reverse().map((row) => ({
      exchange: String(row.exchange),
      symbol: String(row.symbol),
      timeframe: String(row.timeframe) as Candle['timeframe'],
      openTime: parseDate(row.open_time)!.toISOString(),
      closeTime: parseDate(row.close_time)!.toISOString(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      source: String(row.source)
    }));
  }

  async getLastProcessedCloseTime(runId: string, symbolId: string): Promise<string | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT candle_close_time
       FROM signals
       WHERE strategy_run_id = ? AND symbol_id = ?
       ORDER BY candle_close_time DESC
       LIMIT 1`,
      [runId, symbolId]
    );

    return rows[0] ? parseDate(rows[0].candle_close_time)!.toISOString() : null;
  }

  async insertSignal(params: {
    runId: string;
    symbolId: string;
    exchange: string;
    symbol: string;
    timeframe: string;
    signal: StrategySignal;
  }): Promise<SignalRow> {
    const idempotencyKey = [
      params.runId,
      params.symbolId,
      params.signal.candleCloseTime,
      params.signal.signalType
    ].join(':');
    const signalId = randomUUID();

    await execute(
      this.pool,
      `INSERT IGNORE INTO signals (
         id,
         strategy_run_id,
         symbol_id,
         exchange,
         symbol,
         timeframe,
         candle_close_time,
         signal_type,
         signal_strength,
         formula_inputs,
         indicators,
         features,
         reason,
         approved,
         rejection_reason,
         idempotency_key
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [
        signalId,
        params.runId,
        params.symbolId,
        params.exchange,
        params.symbol,
        params.timeframe,
        toMysqlDateTime(params.signal.candleCloseTime),
        params.signal.signalType,
        params.signal.signalStrength,
        JSON.stringify(params.signal.formulaInputs),
        JSON.stringify(params.signal.indicators),
        JSON.stringify(params.signal.features),
        params.signal.reason,
        idempotencyKey
      ]
    );

    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM signals WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );

    return normalizeSignalRow(rows[0]!);
  }

  async updateSignalDecision(signalId: string, decision: RiskDecision): Promise<void> {
    await execute(
      this.pool,
      `UPDATE signals
       SET approved = ?, rejection_reason = ?
       WHERE id = ?`,
      [decision.approved, decision.rejectionReason, signalId]
    );
  }

  async insertRiskEvent(params: {
    runId: string;
    signalId: string;
    symbolId: string;
    decision: RiskDecision;
  }): Promise<void> {
    await execute(
      this.pool,
      `INSERT INTO risk_events (
         id, strategy_run_id, signal_id, symbol_id, approved, reason_code, reason_text, snapshot
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        params.runId,
        params.signalId,
        params.symbolId,
        params.decision.approved,
        params.decision.rejectionCode,
        params.decision.rejectionReason,
        JSON.stringify(params.decision.snapshot)
      ]
    );
  }

  async getOpenPosition(runId: string, symbolId: string): Promise<OpenPositionContext | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM positions
       WHERE strategy_run_id = ? AND symbol_id = ? AND status = 'OPEN'
       LIMIT 1`,
      [runId, symbolId]
    );

    if (!rows[0]) {
      return null;
    }

    const row = normalizePositionRow(rows[0]);

    return {
      id: row.id,
      side: row.side,
      entryTime: row.entry_time.toISOString(),
      entryPrice: row.entry_price,
      qty: row.qty,
      notionalUsdt: row.notional_usdt,
      entryFee: row.entry_fee
    };
  }

  async getOpenPositions(runId: string): Promise<Array<PositionRow & { symbol: string; unrealized_pnl: number | null }>> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT p.*, s.symbol
       FROM positions p
       INNER JOIN symbols s ON s.id = p.symbol_id
       WHERE p.strategy_run_id = ? AND p.status = 'OPEN'
       ORDER BY s.symbol ASC`,
      [runId]
    );

    return Promise.all(
      rows.map(async (rawRow) => {
        const row = normalizePositionRow(rawRow);
        const symbol = String(rawRow.symbol);
        const latestClose = await this.getLatestClose(symbol);
        const unrealizedPnl =
          latestClose === null
            ? null
            : row.side === 'LONG'
              ? round((latestClose - row.entry_price) * row.qty - row.entry_fee, 8)
              : round((row.entry_price - latestClose) * row.qty - row.entry_fee, 8);

        return {
          ...row,
          symbol,
          unrealized_pnl: unrealizedPnl
        };
      })
    );
  }

  async getOpenPositionsCount(runId: string): Promise<number> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT COUNT(*) AS count
       FROM positions
       WHERE strategy_run_id = ? AND status = 'OPEN'`,
      [runId]
    );

    return Number(rows[0]?.count ?? 0);
  }

  async getLastClosedPosition(runId: string, symbolId: string): Promise<PositionRow | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM positions
       WHERE strategy_run_id = ? AND symbol_id = ? AND status = 'CLOSED'
       ORDER BY exit_time DESC
       LIMIT 1`,
      [runId, symbolId]
    );

    return rows[0] ? normalizePositionRow(rows[0]) : null;
  }

  async getConsecutiveLosses(runId: string): Promise<number> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT realized_pnl
       FROM positions
       WHERE strategy_run_id = ? AND status = 'CLOSED'
       ORDER BY exit_time DESC
       LIMIT 50`,
      [runId]
    );

    let losses = 0;

    for (const row of rows) {
      if (Number(row.realized_pnl ?? 0) < 0) {
        losses += 1;
        continue;
      }

      break;
    }

    return losses;
  }

  async getCurrentDrawdownPct(runId: string): Promise<number> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT drawdown_pct
       FROM equity_snapshots
       WHERE strategy_run_id = ?
       ORDER BY snapshot_time DESC
       LIMIT 1`,
      [runId]
    );

    return Number(rows[0]?.drawdown_pct ?? 0);
  }

  async getDailyRealizedPnl(runId: string, isoTime: string): Promise<number> {
    const day = utcDateKey(isoTime);
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT COALESCE(SUM(realized_pnl), 0) AS total
       FROM positions
       WHERE strategy_run_id = ?
         AND status = 'CLOSED'
         AND DATE(exit_time) = ?`,
      [runId, day]
    );

    return Number(rows[0]?.total ?? 0);
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
    const orderId = randomUUID();
    const result = await execute(
      this.pool,
      `INSERT IGNORE INTO simulated_orders (
         id,
         strategy_run_id,
         position_id,
         signal_id,
         symbol_id,
         order_type,
         side,
         intent,
         reference_price,
         qty,
         notional_usdt,
         slippage_bps,
         fee_rate,
         fee_amount,
         fill_model,
         status,
         meta
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [
        orderId,
        params.runId,
        params.positionId ?? null,
        params.signalId,
        params.symbolId,
        params.orderType,
        params.side,
        params.intent,
        params.referencePrice,
        params.qty,
        params.notionalUsdt,
        params.slippageBps,
        params.feeRate,
        params.feeAmount,
        params.fillModel,
        JSON.stringify(params.meta)
      ]
    );

    if (result.affectedRows === 0) {
      return null;
    }

    const rows = await query<MysqlRow>(this.pool, 'SELECT * FROM simulated_orders WHERE id = ? LIMIT 1', [orderId]);
    return normalizeSimulatedOrderRow(rows[0]!);
  }

  async getPendingOrdersForOpenTime(runId: string, symbolId: string, openTime: string): Promise<SimulatedOrderRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM simulated_orders
       WHERE strategy_run_id = ?
         AND symbol_id = ?
         AND status = 'PENDING'
         AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.scheduled_for_open_time')) = ?
       ORDER BY created_at ASC`,
      [runId, symbolId, openTime]
    );

    return rows.map(normalizeSimulatedOrderRow);
  }

  async fillPendingOrder(orderId: string, fillPrice: number, fillTime: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const orders = await query<MysqlRow>(client, 'SELECT * FROM simulated_orders WHERE id = ? FOR UPDATE', [
        orderId
      ]);

      if (!orders[0]) {
        return;
      }

      const order = normalizeSimulatedOrderRow(orders[0]);

      if (order.status !== 'PENDING') {
        return;
      }

      const finalFillPrice = adjustForSlippage(fillPrice, order.side, order.slippage_bps);

      await execute(
        client,
        `UPDATE simulated_orders
         SET fill_price = ?, status = 'FILLED'
         WHERE id = ?`,
        [finalFillPrice, order.id]
      );

      if (order.intent === 'OPEN_POSITION') {
        await execute(
          client,
          `INSERT INTO positions (
             id,
             strategy_run_id,
             symbol_id,
             side,
             status,
             entry_time,
             entry_price,
             qty,
             notional_usdt,
             entry_fee,
             opened_by_signal_id,
             open_slot
           )
           VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            order.strategy_run_id,
            order.symbol_id,
            order.side === 'BUY' ? 'LONG' : 'SHORT',
            toMysqlDateTime(fillTime),
            finalFillPrice,
            order.qty,
            order.notional_usdt,
            order.fee_amount,
            order.signal_id,
            `${order.strategy_run_id}:${order.symbol_id}`
          ]
        );

        return;
      }

      const positionId = String(order.meta.position_id ?? order.position_id ?? '');

      if (!positionId) {
        throw new Error(`Exit order ${order.id} is missing a position reference.`);
      }

      const positions = await query<MysqlRow>(client, 'SELECT * FROM positions WHERE id = ? FOR UPDATE', [positionId]);

      if (!positions[0]) {
        return;
      }

      const position = normalizePositionRow(positions[0]);

      if (position.status !== 'OPEN') {
        return;
      }

      const pnl = calculateTradePnl(
        position.side,
        position.entry_price,
        finalFillPrice,
        position.qty,
        position.entry_fee,
        order.fee_amount
      );

      await execute(
        client,
        `UPDATE positions
         SET
           status = 'CLOSED',
           exit_time = ?,
           exit_price = ?,
           exit_fee = ?,
           realized_pnl = ?,
           closed_by_signal_id = ?,
           open_slot = NULL,
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          toMysqlDateTime(fillTime),
          finalFillPrice,
          order.fee_amount,
          pnl.realizedPnl,
          order.signal_id,
          position.id
        ]
      );

      await execute(
        client,
        `UPDATE simulated_orders
         SET position_id = ?
         WHERE id = ?`,
        [position.id, order.id]
      );
    });
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
    const peaks = await query<MysqlRow>(
      this.pool,
      `SELECT COALESCE(MAX(equity_usdt), ?) AS peak
       FROM equity_snapshots
       WHERE strategy_run_id = ?`,
      [params.equityUsdt, params.runId]
    );

    const peak = Number(peaks[0]?.peak ?? params.equityUsdt);
    const drawdownPct = peak === 0 ? 0 : round(((peak - params.equityUsdt) / peak) * 100, 8);

    await execute(
      this.pool,
      `INSERT INTO equity_snapshots (
         id,
         strategy_run_id,
         snapshot_time,
         balance_usdt,
         equity_usdt,
         unrealized_pnl,
         realized_pnl_cum,
         drawdown_pct,
         open_positions
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        params.runId,
        toMysqlDateTime(params.snapshotTime),
        params.balanceUsdt,
        params.equityUsdt,
        params.unrealizedPnl,
        params.realizedPnlCum,
        drawdownPct,
        params.openPositions
      ]
    );
  }

  async getRealizedPnlCum(runId: string): Promise<number> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT COALESCE(SUM(realized_pnl), 0) AS total
       FROM positions
       WHERE strategy_run_id = ? AND status = 'CLOSED'`,
      [runId]
    );

    return Number(rows[0]?.total ?? 0);
  }

  async getRecentSignals(limit = 100): Promise<SignalRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM signals
       ORDER BY candle_close_time DESC, created_at DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map(normalizeSignalRow);
  }

  async getRecentTrades(limit = 100): Promise<Array<PositionRow & { symbol: string }>> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT p.*, s.symbol
       FROM positions p
       INNER JOIN symbols s ON s.id = p.symbol_id
       WHERE p.status = 'CLOSED'
       ORDER BY p.exit_time DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      ...normalizePositionRow(row),
      symbol: String(row.symbol)
    }));
  }

  async getStatsSummary(runId: string, startingEquity: number): Promise<Record<string, number>> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT
         SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_trades,
         SUM(CASE WHEN status = 'CLOSED' AND realized_pnl > 0 THEN 1 ELSE 0 END) AS wins,
         AVG(CASE WHEN status = 'CLOSED' THEN realized_pnl / NULLIF(notional_usdt, 0) END) AS avg_return,
         SUM(CASE WHEN status = 'CLOSED' THEN realized_pnl ELSE 0 END) AS total_realized,
         (SELECT MAX(drawdown_pct) FROM equity_snapshots WHERE strategy_run_id = ?) AS max_drawdown
       FROM positions
       WHERE strategy_run_id = ?`,
      [runId, runId]
    );

    const row = rows[0];
    const closedTrades = Number(row?.closed_trades ?? 0);
    const wins = Number(row?.wins ?? 0);
    const totalRealized = Number(row?.total_realized ?? 0);

    return {
      closedTrades,
      winRate: closedTrades === 0 ? 0 : round((wins / closedTrades) * 100, 4),
      averageTradeReturn: row?.avg_return === null ? 0 : Number(row?.avg_return ?? 0),
      totalRealizedPnl: totalRealized,
      equity: round(startingEquity + totalRealized, 8),
      maxDrawdownPct: row?.max_drawdown === null ? 0 : Number(row?.max_drawdown ?? 0)
    };
  }

  async getLatestSignalsBySymbol(): Promise<Array<{ symbol: string; signal_type: string; candle_close_time: Date; approved: boolean | null }>> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT symbol, signal_type, candle_close_time, approved
       FROM (
         SELECT
           symbol,
           signal_type,
           candle_close_time,
           approved,
           ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY candle_close_time DESC, created_at DESC) AS rn
         FROM signals
       ) ranked
       WHERE rn = 1`
    );

    return rows.map((row) => ({
      symbol: String(row.symbol),
      signal_type: String(row.signal_type),
      candle_close_time: parseDate(row.candle_close_time)!,
      approved: row.approved === null || row.approved === undefined ? null : parseBoolean(row.approved)
    }));
  }

  async upsertPushSubscription(subscription: PushSubscriptionRecord): Promise<void> {
    await execute(
      this.pool,
      `INSERT INTO push_subscriptions (
         id, user_label, endpoint, p256dh, auth, enabled, symbol_filters, event_filters
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_label = VALUES(user_label),
         p256dh = VALUES(p256dh),
         auth = VALUES(auth),
         enabled = VALUES(enabled),
         symbol_filters = VALUES(symbol_filters),
         event_filters = VALUES(event_filters),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [
        randomUUID(),
        subscription.userLabel,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        subscription.enabled,
        subscription.symbolFilters ? JSON.stringify(subscription.symbolFilters) : null,
        subscription.eventFilters ? JSON.stringify(subscription.eventFilters) : null
      ]
    );
  }

  async disablePushSubscription(endpoint: string): Promise<void> {
    await execute(
      this.pool,
      `UPDATE push_subscriptions
       SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP(3)
       WHERE endpoint = ?`,
      [endpoint]
    );
  }

  async getPushSubscriptionsForEvent(symbol: string, eventType: string): Promise<PushSubscriptionRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM push_subscriptions WHERE enabled = TRUE`
    );

    return rows
      .map(normalizePushSubscriptionRow)
      .filter((subscription) => {
        const symbolMatch =
          subscription.symbol_filters === null ||
          subscription.symbol_filters.length === 0 ||
          subscription.symbol_filters.includes(symbol);
        const eventMatch =
          subscription.event_filters === null ||
          subscription.event_filters.length === 0 ||
          subscription.event_filters.includes(eventType);

        return symbolMatch && eventMatch;
      });
  }

  private async getLatestClose(symbol: string): Promise<number | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT close
       FROM market_candles
       WHERE symbol = ?
       ORDER BY close_time DESC
       LIMIT 1`,
      [symbol]
    );

    return rows[0] ? Number(rows[0].close) : null;
  }

  async computeUnrealizedPnl(runId: string): Promise<number> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT p.entry_price, p.qty, p.entry_fee, p.side, s.symbol
       FROM positions p
       INNER JOIN symbols s ON s.id = p.symbol_id
       WHERE p.strategy_run_id = ? AND p.status = 'OPEN'`,
      [runId]
    );

    let total = 0;

    for (const row of rows) {
      const latestClose = await this.getLatestClose(String(row.symbol));

      if (latestClose === null) {
        continue;
      }

      total += calculateUnrealizedPnl(
        {
          side: String(row.side) as OpenPositionContext['side'],
          entryPrice: Number(row.entry_price),
          qty: Number(row.qty),
          entryFee: Number(row.entry_fee)
        },
        latestClose
      );
    }

    return round(total, 8);
  }
}

export const createDatabase = (connectionString: string): MedvedssonDatabase =>
  new MedvedssonDatabase(createPool(connectionString));
