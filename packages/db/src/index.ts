import { randomUUID } from 'node:crypto';

import { calculateTradePnl } from '@medvedsson/execution';
import {
  adjustForSlippage,
  calculateUnrealizedPnl,
} from '@medvedsson/execution';
import type {
  AppConfig,
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
  exchange: ExchangeName;
  exchange_timeout_ms: number;
  exchange_rate_limit_ms: number;
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

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Unable to parse date value.');
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

const execute = async (
  db: Queryable,
  text: string,
  params: unknown[] = []
): Promise<MysqlResult> => {
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
  updated_at: parseDate(row.updated_at)!,
});

const normalizeSymbolRow = (row: MysqlRow): SymbolRow => ({
  id: String(row.id),
  exchange: String(row.exchange) as ExchangeName,
  exchange_timeout_ms: Number(row.exchange_timeout_ms),
  exchange_rate_limit_ms: Number(row.exchange_rate_limit_ms),
  symbol: String(row.symbol),
  base_asset: String(row.base_asset),
  quote_asset: String(row.quote_asset),
  timeframe: String(row.timeframe) as Timeframe,
  dry_run: parseBoolean(row.dry_run),
  allow_short: parseBoolean(row.allow_short),
  strategy_key: String(row.strategy_key),
  strategy_version: String(row.strategy_version),
  signal_n: Number(row.signal_n),
  signal_k: Number(row.signal_k),
  signal_h_bars: Number(row.signal_h_bars),
  fill_model: String(row.fill_model) as SymbolRow['fill_model'],
  fee_rate: Number(row.fee_rate),
  slippage_bps: Number(row.slippage_bps),
  position_sizing_mode: String(
    row.position_sizing_mode
  ) as SymbolRow['position_sizing_mode'],
  fixed_usdt_per_trade: Number(row.fixed_usdt_per_trade),
  equity_start_usdt: Number(row.equity_start_usdt),
  max_open_positions: Number(row.max_open_positions),
  cooldown_bars: Number(row.cooldown_bars),
  max_daily_drawdown_pct: Number(row.max_daily_drawdown_pct),
  max_consecutive_losses: Number(row.max_consecutive_losses),
  poll_interval_ms: Number(row.poll_interval_ms),
  active: parseBoolean(row.active),
  created_at: parseDate(row.created_at)!,
  updated_at: parseDate(row.updated_at)!,
});

const normalizeSymbolSettings = (
  settings: Partial<SymbolRuntimeSettings> = {}
): SymbolRuntimeSettings => ({
  exchange: settings.exchange ?? DEFAULT_SYMBOL_SETTINGS.exchange,
  exchangeTimeoutMs:
    settings.exchangeTimeoutMs ?? DEFAULT_SYMBOL_SETTINGS.exchangeTimeoutMs,
  exchangeRateLimitMs:
    settings.exchangeRateLimitMs ?? DEFAULT_SYMBOL_SETTINGS.exchangeRateLimitMs,
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
  maxDailyDrawdownPct:
    settings.maxDailyDrawdownPct ?? DEFAULT_SYMBOL_SETTINGS.maxDailyDrawdownPct,
  maxConsecutiveLosses:
    settings.maxConsecutiveLosses ??
    DEFAULT_SYMBOL_SETTINGS.maxConsecutiveLosses,
  pollIntervalMs:
    settings.pollIntervalMs ?? DEFAULT_SYMBOL_SETTINGS.pollIntervalMs,
});

const getSymbolRuntimeSettings = (row: SymbolRow): SymbolRuntimeSettings => ({
  exchange: row.exchange,
  exchangeTimeoutMs: row.exchange_timeout_ms,
  exchangeRateLimitMs: row.exchange_rate_limit_ms,
  timeframe: row.timeframe,
  dryRun: row.dry_run,
  allowShort: row.allow_short,
  strategyKey: row.strategy_key,
  strategyVersion: row.strategy_version,
  signal: {
    n: row.signal_n,
    k: row.signal_k,
    hBars: row.signal_h_bars,
    timeframe: row.timeframe,
  },
  execution: {
    fillModel: row.fill_model,
    positionSizingMode: row.position_sizing_mode,
    feeRate: row.fee_rate,
    slippageBps: row.slippage_bps,
    fixedUsdtPerTrade: row.fixed_usdt_per_trade,
    equityStartUsdt: row.equity_start_usdt,
  },
  maxOpenPositions: row.max_open_positions,
  cooldownBars: row.cooldown_bars,
  maxDailyDrawdownPct: row.max_daily_drawdown_pct,
  maxConsecutiveLosses: row.max_consecutive_losses,
  pollIntervalMs: row.poll_interval_ms,
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
  signal_strength:
    row.signal_strength === null ? null : Number(row.signal_strength),
  formula_inputs: parseJson<Record<string, unknown>>(row.formula_inputs),
  indicators: parseJson<Record<string, unknown>>(row.indicators),
  features: parseJson<Record<string, unknown>>(row.features),
  reason: String(row.reason),
  approved:
    row.approved === null || row.approved === undefined
      ? null
      : parseBoolean(row.approved),
  rejection_reason:
    row.rejection_reason === null ? null : String(row.rejection_reason),
  idempotency_key: String(row.idempotency_key),
  created_at: parseDate(row.created_at)!,
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
  closed_by_signal_id:
    row.closed_by_signal_id === null ? null : String(row.closed_by_signal_id),
  created_at: parseDate(row.created_at)!,
  updated_at: parseDate(row.updated_at)!,
  open_slot:
    row.open_slot === null || row.open_slot === undefined
      ? null
      : String(row.open_slot),
});

const resolveTradeOpenedAt = (
  position: PositionRow,
  openingSignalTime: Date | null
): Date =>
  openingSignalTime !== null &&
  openingSignalTime.getTime() > position.entry_time.getTime()
    ? openingSignalTime
    : position.entry_time;

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
  filled_at: parseDate(row.filled_at),
  qty: Number(row.qty),
  notional_usdt: Number(row.notional_usdt),
  slippage_bps: Number(row.slippage_bps),
  fee_rate: Number(row.fee_rate),
  fee_amount: Number(row.fee_amount),
  fill_model: String(row.fill_model),
  status: String(row.status) as SimulatedOrderRow['status'],
  meta: parseJson<Record<string, unknown>>(row.meta),
  created_at: parseDate(row.created_at)!,
});

const normalizePushSubscriptionRow = (row: MysqlRow): PushSubscriptionRow => ({
  id: String(row.id),
  user_label: row.user_label === null ? null : String(row.user_label),
  endpoint: String(row.endpoint),
  p256dh: String(row.p256dh),
  auth: String(row.auth),
  enabled: parseBoolean(row.enabled),
  symbol_filters:
    row.symbol_filters === null
      ? null
      : parseJson<string[]>(row.symbol_filters),
  event_filters:
    row.event_filters === null ? null : parseJson<string[]>(row.event_filters),
  created_at: parseDate(row.created_at)!,
  updated_at: parseDate(row.updated_at)!,
});

export const createPool = (connectionString: string): DbPoolLike => {
  const pool = mysql.createPool({
    uri: connectionString,
    connectionLimit: 10,
    timezone: 'Z',
    multipleStatements: true,
    decimalNumbers: true,
    dateStrings: true,
  });

  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });

  return pool;
};

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
        await execute(client, 'INSERT INTO schema_migrations (id) VALUES (?)', [
          migration.id,
        ]);
      });
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await query<MysqlRow>(this.pool, 'SELECT 1 AS ok');
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
    const id = randomUUID();

    await execute(
      this.pool,
      `INSERT INTO strategy_runs (
         id, name, strategy_key, version, timeframe, status, dry_run, base_currency, started_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.name,
        params.strategyKey,
        params.version,
        params.timeframe,
        params.status ?? 'RUNNING',
        params.dryRun ?? true,
        params.baseCurrency ?? 'USDT',
        toMysqlDateTime(now),
      ]
    );

    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM strategy_runs WHERE id = ? LIMIT 1',
      [id]
    );
    return normalizeRunRow(rows[0]!);
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
        : getSymbolRuntimeSettings(activeSymbols[0]);

    return this.createRun({
      name: `${baseline.strategyKey}-${baseline.strategyVersion}-${new Date().toISOString()}`,
      strategyKey: baseline.strategyKey,
      version: baseline.strategyVersion,
      timeframe: baseline.timeframe,
      dryRun: baseline.dryRun,
    });
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

  private async upsertSymbolRecord(
    params: SymbolUpsertParams
  ): Promise<SymbolRow> {
    const normalizedSymbol = normalizeSymbol(params.symbol);
    const [baseAsset, quoteAsset] = normalizedSymbol.split('/');
    const settings = normalizeSymbolSettings({
      ...params,
      signal: {
        ...params.signal,
        timeframe: params.timeframe,
      },
    });

    await execute(
      this.pool,
      `INSERT INTO symbols (
         id,
         exchange,
         exchange_timeout_ms,
         exchange_rate_limit_ms,
         symbol,
         base_asset,
         quote_asset,
         timeframe,
         dry_run,
         allow_short,
         strategy_key,
         strategy_version,
         signal_n,
         signal_k,
         signal_h_bars,
         fill_model,
         fee_rate,
         slippage_bps,
         position_sizing_mode,
         fixed_usdt_per_trade,
         equity_start_usdt,
         max_open_positions,
         cooldown_bars,
         max_daily_drawdown_pct,
         max_consecutive_losses,
         poll_interval_ms,
         active
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         exchange_timeout_ms = VALUES(exchange_timeout_ms),
         exchange_rate_limit_ms = VALUES(exchange_rate_limit_ms),
         base_asset = VALUES(base_asset),
         quote_asset = VALUES(quote_asset),
         timeframe = VALUES(timeframe),
         dry_run = VALUES(dry_run),
         allow_short = VALUES(allow_short),
         strategy_key = VALUES(strategy_key),
         strategy_version = VALUES(strategy_version),
         signal_n = VALUES(signal_n),
         signal_k = VALUES(signal_k),
         signal_h_bars = VALUES(signal_h_bars),
         fill_model = VALUES(fill_model),
         fee_rate = VALUES(fee_rate),
         slippage_bps = VALUES(slippage_bps),
         position_sizing_mode = VALUES(position_sizing_mode),
         fixed_usdt_per_trade = VALUES(fixed_usdt_per_trade),
         equity_start_usdt = VALUES(equity_start_usdt),
         max_open_positions = VALUES(max_open_positions),
         cooldown_bars = VALUES(cooldown_bars),
         max_daily_drawdown_pct = VALUES(max_daily_drawdown_pct),
         max_consecutive_losses = VALUES(max_consecutive_losses),
         poll_interval_ms = VALUES(poll_interval_ms),
         active = VALUES(active),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [
        randomUUID(),
        settings.exchange,
        settings.exchangeTimeoutMs,
        settings.exchangeRateLimitMs,
        normalizedSymbol,
        baseAsset,
        quoteAsset,
        settings.timeframe,
        settings.dryRun,
        settings.allowShort,
        settings.strategyKey,
        settings.strategyVersion,
        settings.signal.n,
        settings.signal.k,
        settings.signal.hBars,
        settings.execution.fillModel,
        settings.execution.feeRate,
        settings.execution.slippageBps,
        settings.execution.positionSizingMode,
        settings.execution.fixedUsdtPerTrade,
        settings.execution.equityStartUsdt,
        settings.maxOpenPositions,
        settings.cooldownBars,
        settings.maxDailyDrawdownPct,
        settings.maxConsecutiveLosses,
        settings.pollIntervalMs,
        params.active,
      ]
    );

    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM symbols WHERE exchange = ? AND symbol = ? LIMIT 1',
      [settings.exchange, normalizedSymbol]
    );

    return normalizeSymbolRow(rows[0]!);
  }

  async ensureDefaultSymbols(
    symbols: string[],
    settings: SymbolRuntimeSettings = DEFAULT_SYMBOL_SETTINGS
  ): Promise<SymbolRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT COUNT(*) AS count FROM symbols'
    );

    if (Number(rows[0]?.count ?? 0) > 0) {
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
    const normalizedSettings = normalizeSymbolSettings({
      ...settings,
      exchange,
    });

    await execute(
      this.pool,
      `UPDATE symbols SET active = FALSE, updated_at = CURRENT_TIMESTAMP(3) WHERE exchange = ?`,
      [exchange]
    );

    const results: SymbolRow[] = [];

    for (const symbol of symbols.map(normalizeSymbol)) {
      results.push(
        await this.upsertSymbolRecord({
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
    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM symbols ORDER BY symbol ASC'
    );
    return rows.map(normalizeSymbolRow);
  }

  async getSymbol(
    exchange: ExchangeName,
    symbol: string
  ): Promise<SymbolRow | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM symbols WHERE exchange = ? AND symbol = ? LIMIT 1',
      [exchange, normalizeSymbol(symbol)]
    );

    return rows[0] ? normalizeSymbolRow(rows[0]) : null;
  }

  async getSymbolById(id: string): Promise<SymbolRow | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM symbols WHERE id = ? LIMIT 1',
      [id]
    );

    return rows[0] ? normalizeSymbolRow(rows[0]) : null;
  }

  async updateSymbol(
    id: string,
    params: SymbolUpsertParams
  ): Promise<SymbolRow> {
    const normalizedSymbol = normalizeSymbol(params.symbol);
    const [baseAsset, quoteAsset] = normalizedSymbol.split('/');
    const settings = normalizeSymbolSettings({
      ...params,
      signal: {
        ...params.signal,
        timeframe: params.timeframe,
      },
    });

    await execute(
      this.pool,
      `UPDATE symbols
       SET exchange = ?,
           exchange_timeout_ms = ?,
           exchange_rate_limit_ms = ?,
           symbol = ?,
           base_asset = ?,
           quote_asset = ?,
           timeframe = ?,
           dry_run = ?,
           allow_short = ?,
           strategy_key = ?,
           strategy_version = ?,
           signal_n = ?,
           signal_k = ?,
           signal_h_bars = ?,
           fill_model = ?,
           fee_rate = ?,
           slippage_bps = ?,
           position_sizing_mode = ?,
           fixed_usdt_per_trade = ?,
           equity_start_usdt = ?,
           max_open_positions = ?,
           cooldown_bars = ?,
           max_daily_drawdown_pct = ?,
           max_consecutive_losses = ?,
           poll_interval_ms = ?,
           active = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [
        settings.exchange,
        settings.exchangeTimeoutMs,
        settings.exchangeRateLimitMs,
        normalizedSymbol,
        baseAsset,
        quoteAsset,
        settings.timeframe,
        settings.dryRun,
        settings.allowShort,
        settings.strategyKey,
        settings.strategyVersion,
        settings.signal.n,
        settings.signal.k,
        settings.signal.hBars,
        settings.execution.fillModel,
        settings.execution.feeRate,
        settings.execution.slippageBps,
        settings.execution.positionSizingMode,
        settings.execution.fixedUsdtPerTrade,
        settings.execution.equityStartUsdt,
        settings.maxOpenPositions,
        settings.cooldownBars,
        settings.maxDailyDrawdownPct,
        settings.maxConsecutiveLosses,
        settings.pollIntervalMs,
        params.active,
        id,
      ]
    );

    const row = await this.getSymbolById(id);

    if (!row) {
      throw new Error(`Symbol ${id} was not found after update.`);
    }

    return row;
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
          candle.source,
        ]
      );
    }
  }

  async getRecentCandles(
    exchange: string,
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<Candle[]> {
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
      source: String(row.source),
    }));
  }

  async getCandlesInRange(params: {
    exchange: string;
    symbol: string;
    timeframe: string;
    startTime?: string | null;
    endTime?: string | null;
  }): Promise<Candle[]> {
    const clauses = ['exchange = ?', 'symbol = ?', 'timeframe = ?'];
    const values: unknown[] = [
      params.exchange,
      normalizeSymbol(params.symbol),
      params.timeframe,
    ];

    if (params.startTime) {
      clauses.push('close_time >= ?');
      values.push(toMysqlDateTime(params.startTime));
    }

    if (params.endTime) {
      clauses.push('close_time <= ?');
      values.push(toMysqlDateTime(params.endTime));
    }

    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT exchange, symbol, timeframe, open_time, close_time, open, high, low, close, volume, source
       FROM market_candles
       WHERE ${clauses.join(' AND ')}
       ORDER BY close_time ASC`,
      values
    );

    return rows.map((row) => ({
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
      source: String(row.source),
    }));
  }

  async getLastProcessedCloseTime(
    runId: string,
    symbolId: string
  ): Promise<string | null> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT last_processed_close_time
       FROM run_symbol_progress
       WHERE strategy_run_id = ? AND symbol_id = ?
       LIMIT 1`,
      [runId, symbolId]
    );

    if (rows[0]) {
      return parseDate(rows[0].last_processed_close_time)!.toISOString();
    }

    const legacyRows = await query<MysqlRow>(
      this.pool,
      `SELECT candle_close_time
       FROM signals
       WHERE strategy_run_id = ? AND symbol_id = ?
       ORDER BY candle_close_time DESC
       LIMIT 1`,
      [runId, symbolId]
    );

    return legacyRows[0]
      ? parseDate(legacyRows[0].candle_close_time)!.toISOString()
      : null;
  }

  async recordProcessedCandle(params: {
    runId: string;
    symbolId: string;
    candleCloseTime: string;
  }): Promise<void> {
    await execute(
      this.pool,
      `INSERT INTO run_symbol_progress (
         strategy_run_id,
         symbol_id,
         last_processed_close_time
       )
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_processed_close_time = VALUES(last_processed_close_time),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [params.runId, params.symbolId, toMysqlDateTime(params.candleCloseTime)]
    );
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
        idempotencyKey,
      ]
    );

    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM signals WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );

    return normalizeSignalRow(rows[0]!);
  }

  async updateSignalDecision(
    signalId: string,
    decision: RiskDecision
  ): Promise<void> {
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
        JSON.stringify(params.decision.snapshot),
      ]
    );
  }

  async getOpenPosition(
    runId: string,
    symbolId: string
  ): Promise<OpenPositionContext | null> {
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
      entryFee: row.entry_fee,
    };
  }

  async getOpenPositions(
    runId: string
  ): Promise<
    Array<PositionRow & { symbol: string; unrealized_pnl: number | null }>
  > {
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
              ? round(
                  (latestClose - row.entry_price) * row.qty - row.entry_fee,
                  8
                )
              : round(
                  (row.entry_price - latestClose) * row.qty - row.entry_fee,
                  8
                );

        return {
          ...row,
          symbol,
          unrealized_pnl: unrealizedPnl,
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

  async getLastClosedPosition(
    runId: string,
    symbolId: string
  ): Promise<PositionRow | null> {
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

  async getRealizedPnlBetween(
    startTime: string,
    endTime: string,
    runId: string | null = null
  ): Promise<number> {
    const runFilter = runId === null ? '' : ' AND strategy_run_id = ?';
    const params =
      runId === null
        ? [toMysqlDateTime(startTime), toMysqlDateTime(endTime)]
        : [toMysqlDateTime(startTime), toMysqlDateTime(endTime), runId];
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT COALESCE(SUM(realized_pnl), 0) AS total
       FROM positions
       WHERE status = 'CLOSED'
         AND exit_time >= ?
         AND exit_time < ?${runFilter}`,
      params
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
        JSON.stringify(params.meta),
      ]
    );

    if (result.affectedRows === 0) {
      return null;
    }

    const rows = await query<MysqlRow>(
      this.pool,
      'SELECT * FROM simulated_orders WHERE id = ? LIMIT 1',
      [orderId]
    );
    return normalizeSimulatedOrderRow(rows[0]!);
  }

  async getPendingOrdersForOpenTime(
    runId: string,
    symbolId: string,
    openTime: string
  ): Promise<SimulatedOrderRow[]> {
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

  async fillPendingOrder(
    orderId: string,
    fillPrice: number,
    fillTime: string
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const orders = await query<MysqlRow>(
        client,
        'SELECT * FROM simulated_orders WHERE id = ? FOR UPDATE',
        [orderId]
      );

      if (!orders[0]) {
        return;
      }

      const order = normalizeSimulatedOrderRow(orders[0]);

      if (order.status !== 'PENDING') {
        return;
      }

      const finalFillPrice = adjustForSlippage(
        fillPrice,
        order.side,
        order.slippage_bps
      );
      const recordedAt = toMysqlDateTime(fillTime);

      await execute(
        client,
        `UPDATE simulated_orders
         SET fill_price = ?, filled_at = ?, status = 'FILLED'
         WHERE id = ?`,
        [finalFillPrice, recordedAt, order.id]
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
            `${order.strategy_run_id}:${order.symbol_id}`,
          ]
        );

        return;
      }

      const rawPositionId = order.meta.position_id ?? order.position_id;
      const positionId =
        typeof rawPositionId === 'string' || typeof rawPositionId === 'number'
          ? String(rawPositionId)
          : '';

      if (!positionId) {
        throw new Error(
          `Exit order ${order.id} is missing a position reference.`
        );
      }

      const positions = await query<MysqlRow>(
        client,
        'SELECT * FROM positions WHERE id = ? FOR UPDATE',
        [positionId]
      );

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
          position.id,
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

    const peak = Math.max(
      Number(peaks[0]?.peak ?? params.equityUsdt),
      params.equityUsdt
    );
    const drawdownPct =
      peak === 0 ? 0 : round(((peak - params.equityUsdt) / peak) * 100, 8);

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
        params.openPositions,
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

  async getRecentSignals(limit = 100, offset = 0): Promise<SignalRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT * FROM signals
       ORDER BY candle_close_time DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rows.map(normalizeSignalRow);
  }

  async getRecentSignalsWithCandles(
    limit = 100,
    offset = 0,
    candleCount = 12
  ): Promise<SignalWithCandlesRow[]> {
    const signals = await this.getRecentSignals(limit, offset);

    if (signals.length === 0 || candleCount <= 0) {
      return signals.map((signal) => ({
        ...signal,
        recent_candles: [],
      }));
    }

    const placeholders = signals.map(() => '?').join(', ');
    const candleRows = await query<MysqlRow>(
      this.pool,
      `WITH ranked_candles AS (
         SELECT
           s.id AS signal_id,
           mc.exchange AS candle_exchange,
           mc.symbol AS candle_symbol,
           mc.timeframe AS candle_timeframe,
           mc.open_time AS candle_open_time,
           mc.close_time AS candle_close_time,
           mc.open AS candle_open,
           mc.high AS candle_high,
           mc.low AS candle_low,
           mc.close AS candle_close,
           mc.volume AS candle_volume,
           mc.source AS candle_source,
           ROW_NUMBER() OVER (
             PARTITION BY s.id
             ORDER BY mc.close_time DESC
           ) AS candle_rank
         FROM signals s
         LEFT JOIN market_candles mc
           ON mc.exchange = s.exchange
          AND mc.symbol = s.symbol
          AND mc.timeframe = s.timeframe
          AND mc.close_time <= s.candle_close_time
         WHERE s.id IN (${placeholders})
       )
       SELECT *
       FROM ranked_candles
       WHERE candle_rank <= ?
       ORDER BY signal_id ASC, candle_rank DESC`,
      [...signals.map((signal) => signal.id), candleCount]
    );

    const candlesBySignalId = new Map<string, Candle[]>();

    for (const row of candleRows) {
      const signalId = String(row.signal_id);

      if (!candlesBySignalId.has(signalId)) {
        candlesBySignalId.set(signalId, []);
      }

      if (row.candle_close_time === null) {
        continue;
      }

      candlesBySignalId.get(signalId)!.push({
        exchange: String(row.candle_exchange),
        symbol: String(row.candle_symbol),
        timeframe: String(row.candle_timeframe) as Candle['timeframe'],
        openTime: parseDate(row.candle_open_time)!.toISOString(),
        closeTime: parseDate(row.candle_close_time)!.toISOString(),
        open: Number(row.candle_open),
        high: Number(row.candle_high),
        low: Number(row.candle_low),
        close: Number(row.candle_close),
        volume: Number(row.candle_volume),
        source: String(row.candle_source),
      });
    }

    return signals.map((signal) => ({
      ...signal,
      recent_candles: candlesBySignalId.get(signal.id) ?? [],
    }));
  }

  async getRecentTrades(limit = 100, offset = 0): Promise<RecentTradeRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT
         p.*,
         s.symbol,
         os.candle_close_time AS opening_signal_time,
         oo.created_at AS opening_order_created_at,
         oo.filled_at AS opening_order_filled_at
       FROM positions p
       INNER JOIN symbols s ON s.id = p.symbol_id
       INNER JOIN signals os ON os.id = p.opened_by_signal_id
       INNER JOIN simulated_orders oo
         ON oo.signal_id = p.opened_by_signal_id
        AND oo.intent = 'OPEN_POSITION'
       WHERE p.status = 'CLOSED'
       ORDER BY GREATEST(p.entry_time, os.candle_close_time) DESC,
                p.updated_at DESC,
                p.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rows.map((row) => {
      const position = normalizePositionRow(row);
      const openingSignalTime = parseDate(row.opening_signal_time);

      return {
        ...position,
        symbol: String(row.symbol),
        opened_at: resolveTradeOpenedAt(position, openingSignalTime),
        opening_order_created_at: parseDate(row.opening_order_created_at)!,
        opening_order_filled_at: parseDate(row.opening_order_filled_at),
      };
    });
  }

  async getStatsSummary(
    runId: string | null,
    startingEquity: number
  ): Promise<Record<string, number>> {
    const runFilter = runId === null ? '' : 'WHERE strategy_run_id = ?';
    const drawdownFilter = runId === null ? '' : ' WHERE strategy_run_id = ?';
    const params = runId === null ? [] : [runId, runId];
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT
         SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_trades,
         SUM(CASE WHEN status = 'CLOSED' AND realized_pnl > 0 THEN 1 ELSE 0 END) AS wins,
         AVG(CASE WHEN status = 'CLOSED' THEN realized_pnl / NULLIF(notional_usdt, 0) END) AS avg_return,
         SUM(CASE WHEN status = 'CLOSED' THEN realized_pnl ELSE 0 END) AS total_realized,
         (SELECT MAX(drawdown_pct) FROM equity_snapshots${drawdownFilter}) AS max_drawdown
       FROM positions
       ${runFilter}`,
      params
    );

    const row = rows[0];
    const closedTrades = Number(row?.closed_trades ?? 0);
    const wins = Number(row?.wins ?? 0);
    const totalRealized = Number(row?.total_realized ?? 0);

    return {
      closedTrades,
      winRate: closedTrades === 0 ? 0 : round((wins / closedTrades) * 100, 4),
      averageTradeReturn:
        row?.avg_return === null ? 0 : Number(row?.avg_return ?? 0),
      totalRealizedPnl: totalRealized,
      equity: round(startingEquity + totalRealized, 8),
      maxDrawdownPct:
        row?.max_drawdown === null ? 0 : Number(row?.max_drawdown ?? 0),
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
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT symbol, signal_type, candle_close_time, created_at, approved
       FROM (
         SELECT
           symbol,
           signal_type,
           candle_close_time,
           created_at,
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
      created_at: parseDate(row.created_at)!,
      approved:
        row.approved === null || row.approved === undefined
          ? null
          : parseBoolean(row.approved),
    }));
  }

  async upsertPushSubscription(
    subscription: PushSubscriptionRecord
  ): Promise<void> {
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
        null,
        subscription.eventFilters
          ? JSON.stringify(subscription.eventFilters)
          : null,
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

  async getPushSubscriptionsForEvent(
    _symbol: string,
    eventType: string
  ): Promise<PushSubscriptionRow[]> {
    const rows = await query<MysqlRow>(
      this.pool,
      `SELECT *
       FROM push_subscriptions
       WHERE enabled = TRUE
         AND (
           event_filters IS NULL
           OR JSON_LENGTH(event_filters) = 0
           OR JSON_CONTAINS(event_filters, JSON_QUOTE(?))
         )`,
      [eventType]
    );

    return rows.map(normalizePushSubscriptionRow);
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
          entryFee: Number(row.entry_fee),
        },
        latestClose
      );
    }

    return round(total, 8);
  }
}

export const createDatabase = (connectionString: string): MedvedssonDatabase =>
  new MedvedssonDatabase(createPool(connectionString));
