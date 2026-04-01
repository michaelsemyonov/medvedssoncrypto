import { SettingsClient } from '@/components/settings-client.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    vapidPublicKey: string;
    symbols: Array<{
      id: string;
      exchange: 'bybit' | 'binance' | 'okx';
      exchange_timeout_ms: number;
      exchange_rate_limit_ms: number;
      position_broker: 'bybit' | 'okx';
      counter_position_broker: 'bybit' | 'okx';
      symbol: string;
      base_asset: string;
      quote_asset: string;
      timeframe: '5m' | '15m';
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
    }>;
    defaults: {
      symbol: string;
      active: boolean;
      exchange: 'bybit' | 'binance' | 'okx';
      exchangeTimeoutMs: number;
      exchangeRateLimitMs: number;
      positionBroker: 'bybit' | 'okx';
      counterPositionBroker: 'bybit' | 'okx';
      timeframe: '5m' | '15m';
      dryRun: boolean;
      allowShort: boolean;
      strategyKey: string;
      strategyVersion: string;
      signalN: number;
      signalK: number;
      signalHBars: number;
      fillModel: 'next_open';
      feeRate: number;
      slippageBps: number;
      positionSizingMode: 'fixed_usdt';
      fixedUsdtPerTrade: number;
      equityStartUsdt: number;
      maxOpenPositions: number;
      cooldownBars: number;
      stopLossPct: number;
      maxDailyDrawdownPct: number;
      maxConsecutiveLosses: number;
      pollIntervalMs: number;
    };
  }>('/settings', {
    vapidPublicKey: '',
    symbols: [],
    defaults: {
      symbol: '',
      active: true,
      exchange: 'bybit',
      exchangeTimeoutMs: 10000,
      exchangeRateLimitMs: 300,
      positionBroker: 'bybit',
      counterPositionBroker: 'okx',
      timeframe: '5m',
      dryRun: true,
      allowShort: true,
      strategyKey: 'momentum_96_5_72',
      strategyVersion: '1.0.0',
      signalN: 96,
      signalK: 5,
      signalHBars: 72,
      fillModel: 'next_open',
      feeRate: 0.001,
      slippageBps: 5,
      positionSizingMode: 'fixed_usdt',
      fixedUsdtPerTrade: 100,
      equityStartUsdt: 10000,
      maxOpenPositions: 5,
      cooldownBars: 3,
      stopLossPct: 2,
      maxDailyDrawdownPct: 5,
      maxConsecutiveLosses: 5,
      pollIntervalMs: 15000,
    },
  });

  return (
    <SettingsClient
      apiUnavailable={unavailable}
      vapidPublicKey={String(data.vapidPublicKey ?? '')}
      symbols={data.symbols ?? []}
      defaults={data.defaults}
    />
  );
}
