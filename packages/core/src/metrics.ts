import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry
});

export const candlesProcessedCounter = new Counter({
  name: 'medvedsson_candles_processed_total',
  help: 'Total processed closed candles.',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const duplicateCandlesSkippedCounter = new Counter({
  name: 'medvedsson_duplicate_candles_skipped_total',
  help: 'Total skipped already-processed candles.',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const signalsCreatedCounter = new Counter({
  name: 'medvedsson_signals_created_total',
  help: 'Total created strategy signals.',
  labelNames: ['symbol', 'signal_type'],
  registers: [metricsRegistry]
});

export const signalDecisionCounter = new Counter({
  name: 'medvedsson_signal_decisions_total',
  help: 'Signal approvals and rejections.',
  labelNames: ['symbol', 'approved'],
  registers: [metricsRegistry]
});

export const simulatedOrdersCounter = new Counter({
  name: 'medvedsson_simulated_orders_total',
  help: 'Simulated orders created.',
  labelNames: ['symbol', 'intent'],
  registers: [metricsRegistry]
});

export const openPositionsGauge = new Gauge({
  name: 'medvedsson_open_positions',
  help: 'Current open positions.',
  registers: [metricsRegistry]
});

export const realizedPnlGauge = new Gauge({
  name: 'medvedsson_realized_pnl_usdt',
  help: 'Cumulative realized PnL in USDT.',
  registers: [metricsRegistry]
});

export const unrealizedPnlGauge = new Gauge({
  name: 'medvedsson_unrealized_pnl_usdt',
  help: 'Current unrealized PnL in USDT.',
  registers: [metricsRegistry]
});

export const drawdownGauge = new Gauge({
  name: 'medvedsson_drawdown_pct',
  help: 'Current drawdown percent.',
  registers: [metricsRegistry]
});

export const candleLagGauge = new Gauge({
  name: 'medvedsson_candle_lag_ms',
  help: 'Lag between now and latest processed candle close.',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const marketDataLatencyGauge = new Gauge({
  name: 'medvedsson_market_data_latency_ms',
  help: 'Market data fetch latency.',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const dbWriteErrorsCounter = new Counter({
  name: 'medvedsson_db_write_errors_total',
  help: 'Database write failures.',
  registers: [metricsRegistry]
});

export const runnerErrorsCounter = new Counter({
  name: 'medvedsson_runner_errors_total',
  help: 'Runner tick failures.',
  registers: [metricsRegistry]
});

export const notificationFailuresCounter = new Counter({
  name: 'medvedsson_notification_failures_total',
  help: 'Notification delivery failures.',
  registers: [metricsRegistry]
});
