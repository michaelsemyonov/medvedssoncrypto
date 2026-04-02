'use client';

import { useEffect, useMemo, useState } from 'react';

type TrailingProfile = 'conservative' | 'balanced' | 'aggressive' | 'custom';

const TRAILING_PRESETS: Record<
  Exclude<TrailingProfile, 'custom'>,
  {
    trailingActivationProfitPct: number;
    trailingGivebackRatio: number;
    trailingGivebackMinPct: number;
    trailingGivebackMaxPct: number;
    trailingMinLockedProfitPct: number;
  }
> = {
  conservative: {
    trailingActivationProfitPct: 1.8,
    trailingGivebackRatio: 0.45,
    trailingGivebackMinPct: 0.6,
    trailingGivebackMaxPct: 2.0,
    trailingMinLockedProfitPct: 0.5,
  },
  balanced: {
    trailingActivationProfitPct: 1.2,
    trailingGivebackRatio: 0.35,
    trailingGivebackMinPct: 0.4,
    trailingGivebackMaxPct: 1.5,
    trailingMinLockedProfitPct: 0.4,
  },
  aggressive: {
    trailingActivationProfitPct: 0.8,
    trailingGivebackRatio: 0.25,
    trailingGivebackMinPct: 0.25,
    trailingGivebackMaxPct: 1.0,
    trailingMinLockedProfitPct: 0.25,
  },
};

type ApiSymbol = {
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
  trailing_profile: TrailingProfile;
  trailing_enabled: boolean;
  trailing_activation_profit_pct: number;
  trailing_giveback_ratio: number;
  trailing_giveback_min_pct: number;
  trailing_giveback_max_pct: number;
  trailing_min_locked_profit_pct: number;
  max_daily_drawdown_pct: number;
  max_consecutive_losses: number;
  poll_interval_ms: number;
  active: boolean;
};

type SymbolDraft = {
  id?: string;
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
  trailingProfile: TrailingProfile;
  trailingEnabled: boolean;
  trailingActivationProfitPct: number;
  trailingGivebackRatio: number;
  trailingGivebackMinPct: number;
  trailingGivebackMaxPct: number;
  trailingMinLockedProfitPct: number;
  maxDailyDrawdownPct: number;
  maxConsecutiveLosses: number;
  pollIntervalMs: number;
};

type ManagedExchange = 'bybit' | 'okx';

type ExchangeAccount = {
  exchange: ManagedExchange;
  apiKeyMask: string | null;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasApiPassphrase: boolean;
  lastValidatedAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

type ExchangeDraft = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};

type SettingsClientProps = {
  apiUnavailable: boolean;
  vapidPublicKey: string;
  exchangeAccounts: ExchangeAccount[];
  symbols: ApiSymbol[];
  defaults: SymbolDraft;
};

type SettingsTab = 'symbols' | 'exchanges' | 'pushes';

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map((character) => character.charCodeAt(0))
  );
};

const mapApiSymbolToDraft = (symbol: ApiSymbol): SymbolDraft => ({
  id: symbol.id,
  symbol: symbol.symbol,
  active: symbol.active,
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
  signalN: symbol.signal_n,
  signalK: symbol.signal_k,
  signalHBars: symbol.signal_h_bars,
  fillModel: symbol.fill_model,
  feeRate: symbol.fee_rate,
  slippageBps: symbol.slippage_bps,
  positionSizingMode: symbol.position_sizing_mode,
  fixedUsdtPerTrade: symbol.fixed_usdt_per_trade,
  equityStartUsdt: symbol.equity_start_usdt,
  maxOpenPositions: symbol.max_open_positions,
  cooldownBars: symbol.cooldown_bars,
  stopLossPct: symbol.stop_loss_pct,
  trailingProfile: symbol.trailing_profile,
  trailingEnabled: symbol.trailing_enabled,
  trailingActivationProfitPct: symbol.trailing_activation_profit_pct,
  trailingGivebackRatio: symbol.trailing_giveback_ratio,
  trailingGivebackMinPct: symbol.trailing_giveback_min_pct,
  trailingGivebackMaxPct: symbol.trailing_giveback_max_pct,
  trailingMinLockedProfitPct: symbol.trailing_min_locked_profit_pct,
  maxDailyDrawdownPct: symbol.max_daily_drawdown_pct,
  maxConsecutiveLosses: symbol.max_consecutive_losses,
  pollIntervalMs: symbol.poll_interval_ms,
});

const MANAGED_EXCHANGES: ManagedExchange[] = ['bybit', 'okx'];

const EMPTY_EXCHANGE_DRAFT: ExchangeDraft = {
  apiKey: '',
  apiSecret: '',
  apiPassphrase: '',
};

const buildExchangeAccounts = (
  accounts: ExchangeAccount[]
): Record<ManagedExchange, ExchangeAccount> =>
  Object.fromEntries(
    MANAGED_EXCHANGES.map((exchange) => [
      exchange,
      accounts.find((account) => account.exchange === exchange) ?? {
        exchange,
        apiKeyMask: null,
        hasApiKey: false,
        hasApiSecret: false,
        hasApiPassphrase: false,
        lastValidatedAt: null,
        lastSyncAt: null,
        lastSyncError: null,
      },
    ])
  ) as Record<ManagedExchange, ExchangeAccount>;

const formatTimestamp = (value: string | null): string =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Never';

const cloneDraft = (draft: SymbolDraft): SymbolDraft => ({ ...draft });

const sortBySymbol = (symbols: SymbolDraft[]): SymbolDraft[] =>
  [...symbols].sort((left, right) => left.symbol.localeCompare(right.symbol));

const NEW_SYMBOL_MODAL_ID = '__new_symbol__';

const isDraftPristine = (
  draft: SymbolDraft,
  defaults: SymbolDraft
): boolean => {
  const draftValues = { ...draft };
  const defaultValues = { ...defaults };
  delete draftValues.id;
  delete defaultValues.id;

  return JSON.stringify(draftValues) === JSON.stringify(defaultValues);
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as {
      error?: string;
      details?: { formErrors?: string[] };
    };
    return (
      payload.error ??
      payload.details?.formErrors?.[0] ??
      `Request failed (${response.status}).`
    );
  } catch {
    return `Request failed (${response.status}).`;
  }
};

type SymbolEditorProps = {
  title: string;
  submitLabel: string;
  status: string | undefined;
  saving: boolean;
  draft: SymbolDraft;
  onChange: <TKey extends keyof SymbolDraft>(
    key: TKey,
    value: SymbolDraft[TKey]
  ) => void;
  onClose: () => void;
  onSubmit: () => void;
};

const handleProfileChange = (
  profile: TrailingProfile,
  onChange: SymbolEditorProps['onChange']
) => {
  onChange('trailingProfile', profile);

  if (profile !== 'custom') {
    const preset = TRAILING_PRESETS[profile];
    onChange('trailingActivationProfitPct', preset.trailingActivationProfitPct);
    onChange('trailingGivebackRatio', preset.trailingGivebackRatio);
    onChange('trailingGivebackMinPct', preset.trailingGivebackMinPct);
    onChange('trailingGivebackMaxPct', preset.trailingGivebackMaxPct);
    onChange('trailingMinLockedProfitPct', preset.trailingMinLockedProfitPct);
  }
};

function SymbolEditor({
  title,
  submitLabel,
  status,
  saving,
  draft,
  onChange,
  onClose,
  onSubmit,
}: SymbolEditorProps) {
  return (
    <section className="stack-lg">
      <div className="settings-head">
        <div>
          <div className="eyebrow">{title}</div>
          <h2>{draft.symbol || 'Unsaved symbol'}</h2>
        </div>
        <span className={draft.active ? 'pill' : 'pill pill-warn'}>
          {draft.active ? 'Active' : 'Paused'}
        </span>
      </div>

      <div className="settings-section">
        <h3>Market</h3>
        <div className="field-grid">
          <label className="field-stack">
            <span>Symbol</span>
            <input
              className="input"
              value={draft.symbol}
              onChange={(event) => onChange('symbol', event.target.value)}
              placeholder="BTC/USDT"
            />
          </label>
          <label className="field-stack">
            <span>Market Data Exchange</span>
            <select
              className="input"
              value={draft.exchange}
              onChange={(event) =>
                onChange(
                  'exchange',
                  event.target.value as SymbolDraft['exchange']
                )
              }
            >
              <option value="bybit">Bybit</option>
              <option value="okx">OKX</option>
              <option value="binance">Binance (legacy)</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Position Broker</span>
            <select
              className="input"
              value={draft.positionBroker}
              onChange={(event) =>
                onChange(
                  'positionBroker',
                  event.target.value as SymbolDraft['positionBroker']
                )
              }
            >
              <option value="bybit">Bybit</option>
              <option value="okx">OKX</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Counter Position Broker</span>
            <select
              className="input"
              value={draft.counterPositionBroker}
              onChange={(event) =>
                onChange(
                  'counterPositionBroker',
                  event.target.value as SymbolDraft['counterPositionBroker']
                )
              }
            >
              <option value="bybit">Bybit</option>
              <option value="okx">OKX</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Timeframe</span>
            <select
              className="input"
              value={draft.timeframe}
              onChange={(event) =>
                onChange(
                  'timeframe',
                  event.target.value as SymbolDraft['timeframe']
                )
              }
            >
              <option value="5m">5m</option>
              <option value="15m">15m</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Poll Interval (ms)</span>
            <input
              className="input"
              type="number"
              min={100}
              value={draft.pollIntervalMs}
              onChange={(event) =>
                onChange('pollIntervalMs', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Exchange Timeout (ms)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={draft.exchangeTimeoutMs}
              onChange={(event) =>
                onChange('exchangeTimeoutMs', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Exchange Rate Limit (ms)</span>
            <input
              className="input"
              type="number"
              min={0}
              value={draft.exchangeRateLimitMs}
              onChange={(event) =>
                onChange('exchangeRateLimitMs', Number(event.target.value))
              }
            />
          </label>
        </div>
        <div className="toggle-grid">
          <label className="toggle-row">
            <input
              checked={draft.active}
              onChange={(event) => onChange('active', event.target.checked)}
              type="checkbox"
            />
            <span>Active</span>
          </label>
          <label className="toggle-row">
            <input
              checked={draft.dryRun}
              onChange={(event) => onChange('dryRun', event.target.checked)}
              type="checkbox"
            />
            <span>Dry Run</span>
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>Strategy</h3>
        <div className="field-grid">
          <label className="field-stack">
            <span>Strategy Key</span>
            <input
              className="input"
              value={draft.strategyKey}
              onChange={(event) => onChange('strategyKey', event.target.value)}
            />
          </label>
          <label className="field-stack">
            <span>Strategy Version</span>
            <input
              className="input"
              value={draft.strategyVersion}
              onChange={(event) =>
                onChange('strategyVersion', event.target.value)
              }
            />
          </label>
          <label className="field-stack">
            <span>Signal N</span>
            <input
              className="input"
              type="number"
              min={1}
              value={draft.signalN}
              onChange={(event) =>
                onChange('signalN', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Signal K</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.signalK}
              onChange={(event) =>
                onChange('signalK', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Signal Hold Bars</span>
            <input
              className="input"
              type="number"
              min={1}
              value={draft.signalHBars}
              onChange={(event) =>
                onChange('signalHBars', Number(event.target.value))
              }
            />
          </label>
        </div>
        <div className="toggle-grid">
          <label className="toggle-row">
            <input
              checked={draft.allowShort}
              onChange={(event) => onChange('allowShort', event.target.checked)}
              type="checkbox"
            />
            <span>Allow Short</span>
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>Execution</h3>
        <div className="field-grid">
          <label className="field-stack">
            <span>Fill Model</span>
            <select
              className="input"
              value={draft.fillModel}
              onChange={(event) =>
                onChange(
                  'fillModel',
                  event.target.value as SymbolDraft['fillModel']
                )
              }
            >
              <option value="next_open">next_open</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Position Sizing</span>
            <select
              className="input"
              value={draft.positionSizingMode}
              onChange={(event) =>
                onChange(
                  'positionSizingMode',
                  event.target.value as SymbolDraft['positionSizingMode']
                )
              }
            >
              <option value="fixed_usdt">fixed_usdt</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Fee Rate</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.feeRate}
              onChange={(event) =>
                onChange('feeRate', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Slippage (bps)</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.slippageBps}
              onChange={(event) =>
                onChange('slippageBps', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Fixed USDT Per Trade</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.fixedUsdtPerTrade}
              onChange={(event) =>
                onChange('fixedUsdtPerTrade', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Equity Start (USDT)</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.equityStartUsdt}
              onChange={(event) =>
                onChange('equityStartUsdt', Number(event.target.value))
              }
            />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>Risk</h3>
        <div className="field-grid">
          <label className="field-stack">
            <span>Max Open Positions</span>
            <input
              className="input"
              type="number"
              min={1}
              value={draft.maxOpenPositions}
              onChange={(event) =>
                onChange('maxOpenPositions', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Cooldown Bars</span>
            <input
              className="input"
              type="number"
              min={0}
              value={draft.cooldownBars}
              onChange={(event) =>
                onChange('cooldownBars', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Stop Loss %</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.stopLossPct}
              onChange={(event) =>
                onChange('stopLossPct', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Max Daily Drawdown %</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.maxDailyDrawdownPct}
              onChange={(event) =>
                onChange('maxDailyDrawdownPct', Number(event.target.value))
              }
            />
          </label>
          <label className="field-stack">
            <span>Max Consecutive Losses</span>
            <input
              className="input"
              type="number"
              min={0}
              value={draft.maxConsecutiveLosses}
              onChange={(event) =>
                onChange('maxConsecutiveLosses', Number(event.target.value))
              }
            />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>Exit / Trailing Profit</h3>
        <div className="toggle-grid">
          <label className="toggle-row">
            <input
              checked={draft.trailingEnabled}
              onChange={(event) =>
                onChange('trailingEnabled', event.target.checked)
              }
              type="checkbox"
            />
            <span>Trailing Profit Enabled</span>
          </label>
        </div>
        <div className="field-grid">
          <label className="field-stack">
            <span>Profile</span>
            <select
              className="input"
              value={draft.trailingProfile}
              onChange={(event) =>
                handleProfileChange(
                  event.target.value as TrailingProfile,
                  onChange
                )
              }
            >
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced (recommended)</option>
              <option value="aggressive">Aggressive</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Activation Profit %</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.trailingActivationProfitPct}
              onChange={(event) => {
                onChange(
                  'trailingActivationProfitPct',
                  Number(event.target.value)
                );
                onChange('trailingProfile', 'custom');
              }}
            />
          </label>
          <label className="field-stack">
            <span>Giveback Ratio</span>
            <input
              className="input"
              type="number"
              min={0}
              max={1}
              step="any"
              value={draft.trailingGivebackRatio}
              onChange={(event) => {
                onChange('trailingGivebackRatio', Number(event.target.value));
                onChange('trailingProfile', 'custom');
              }}
            />
          </label>
          <label className="field-stack">
            <span>Giveback Min %</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.trailingGivebackMinPct}
              onChange={(event) => {
                onChange('trailingGivebackMinPct', Number(event.target.value));
                onChange('trailingProfile', 'custom');
              }}
            />
          </label>
          <label className="field-stack">
            <span>Giveback Max %</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.trailingGivebackMaxPct}
              onChange={(event) => {
                onChange('trailingGivebackMaxPct', Number(event.target.value));
                onChange('trailingProfile', 'custom');
              }}
            />
          </label>
          <label className="field-stack">
            <span>Min Locked Profit %</span>
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={draft.trailingMinLockedProfitPct}
              onChange={(event) => {
                onChange(
                  'trailingMinLockedProfitPct',
                  Number(event.target.value)
                );
                onChange('trailingProfile', 'custom');
              }}
            />
          </label>
        </div>
      </div>

      <div className="button-row">
        <button
          className="secondary-button"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
        <button
          className="primary-button"
          disabled={saving}
          onClick={onSubmit}
          type="button"
        >
          {saving ? 'Saving...' : submitLabel}
        </button>
      </div>
      <p className="status-line">{status ?? ' '}</p>
    </section>
  );
}

type ExchangePanelProps = {
  account: ExchangeAccount;
  draft: ExchangeDraft;
  saving: boolean;
  status: string | undefined;
  onChange: <TKey extends keyof ExchangeDraft>(
    key: TKey,
    value: ExchangeDraft[TKey]
  ) => void;
  onSave: () => void;
  onSync: () => void;
  onApplyStopLosses: () => void;
};

function ExchangePanel({
  account,
  draft,
  saving,
  status,
  onChange,
  onSave,
  onSync,
  onApplyStopLosses,
}: ExchangePanelProps) {
  return (
    <section className="card exchange-panel">
      <div className="settings-head">
        <div>
          <div className="eyebrow">Exchange Integration</div>
          <h2>{account.exchange === 'bybit' ? 'Bybit' : 'OKX'}</h2>
        </div>
        <span
          className={
            account.hasApiKey && account.hasApiSecret
              ? 'pill'
              : 'pill pill-warn'
          }
        >
          {account.hasApiKey && account.hasApiSecret
            ? 'Credentials Stored'
            : 'Credentials Missing'}
        </span>
      </div>

      <div className="settings-section">
        <h3>Credentials</h3>
        <div className="field-grid">
          <label className="field-stack">
            <span>API Key</span>
            <input
              className="input"
              onChange={(event) => onChange('apiKey', event.target.value)}
              placeholder={account.apiKeyMask ?? 'Paste a new API key'}
              value={draft.apiKey}
            />
          </label>
          <label className="field-stack">
            <span>API Secret</span>
            <input
              className="input"
              onChange={(event) => onChange('apiSecret', event.target.value)}
              placeholder={
                account.hasApiSecret ? 'Stored. Enter to replace.' : 'Paste a new API secret'
              }
              type="password"
              value={draft.apiSecret}
            />
          </label>
          {account.exchange === 'okx' ? (
            <label className="field-stack">
              <span>Passphrase</span>
              <input
                className="input"
                onChange={(event) =>
                  onChange('apiPassphrase', event.target.value)
                }
                placeholder={
                  account.hasApiPassphrase
                    ? 'Stored. Enter to replace.'
                    : 'Paste the OKX API passphrase'
                }
                type="password"
                value={draft.apiPassphrase}
              />
            </label>
          ) : null}
        </div>
        <div className="button-row">
          <button
            className="primary-button"
            disabled={saving}
            onClick={onSave}
            type="button"
          >
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>Position Sync</h3>
        <div className="signal-grid">
          <div className="signal-field">
            <span className="signal-field-label">Last Validation</span>
            <strong>{formatTimestamp(account.lastValidatedAt)}</strong>
          </div>
          <div className="signal-field">
            <span className="signal-field-label">Last Position Sync</span>
            <strong>{formatTimestamp(account.lastSyncAt)}</strong>
          </div>
          <div className="signal-field">
            <span className="signal-field-label">Latest Result</span>
            <strong>{account.lastSyncError ?? 'Healthy'}</strong>
          </div>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={onSync} type="button">
            Sync Open Positions
          </button>
          <button
            className="secondary-button"
            onClick={onApplyStopLosses}
            type="button"
          >
            Apply Stop Losses
          </button>
        </div>
      </div>

      <p className="status-line">{status ?? ' '}</p>
    </section>
  );
}

export function SettingsClient({
  apiUnavailable,
  vapidPublicKey,
  exchangeAccounts: initialExchangeAccounts,
  symbols: initialSymbols,
  defaults,
}: SettingsClientProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('symbols');
  const [status, setStatus] = useState<string>('Idle');
  const [exchangeAccounts, setExchangeAccounts] = useState<
    Record<ManagedExchange, ExchangeAccount>
  >(() => buildExchangeAccounts(initialExchangeAccounts));
  const [exchangeDrafts, setExchangeDrafts] = useState<
    Record<ManagedExchange, ExchangeDraft>
  >({
    bybit: { ...EMPTY_EXCHANGE_DRAFT },
    okx: { ...EMPTY_EXCHANGE_DRAFT },
  });
  const [exchangeStatus, setExchangeStatus] = useState<
    Partial<Record<ManagedExchange, string>>
  >({});
  const [exchangeSavingKey, setExchangeSavingKey] =
    useState<ManagedExchange | null>(null);
  const [symbols, setSymbols] = useState<SymbolDraft[]>(
    sortBySymbol(initialSymbols.map(mapApiSymbolToDraft))
  );
  const [newSymbol, setNewSymbol] = useState<SymbolDraft>(() =>
    cloneDraft(defaults)
  );
  const [symbolStatus, setSymbolStatus] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeSymbolId, setActiveSymbolId] = useState<string | null>(null);

  const hasUnsavedNewSymbol = useMemo(
    () => !isDraftPristine(newSymbol, defaults),
    [defaults, newSymbol]
  );

  const activeSymbolDraft =
    activeSymbolId === NEW_SYMBOL_MODAL_ID
      ? newSymbol
      : symbols.find((symbol) => symbol.id === activeSymbolId) ?? null;

  const activeSymbolTitle =
    activeSymbolId === NEW_SYMBOL_MODAL_ID
      ? hasUnsavedNewSymbol
        ? 'Unsaved Symbol'
        : 'Add Symbol'
      : 'Edit Symbol';

  const activeSymbolStatus =
    activeSymbolId === NEW_SYMBOL_MODAL_ID
      ? symbolStatus.new
      : activeSymbolId
        ? symbolStatus[activeSymbolId]
        : undefined;

  useEffect(() => {
    if (activeSymbolId === null) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveSymbolId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSymbolId]);

  const updateSymbolDraft = <TKey extends keyof SymbolDraft>(
    id: string,
    key: TKey,
    value: SymbolDraft[TKey]
  ) => {
    setSymbols((current) =>
      current.map((symbol) =>
        symbol.id === id ? { ...symbol, [key]: value } : symbol
      )
    );
  };

  const updateNewSymbol = <TKey extends keyof SymbolDraft>(
    key: TKey,
    value: SymbolDraft[TKey]
  ) => {
    setNewSymbol((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const persistSymbol = async (draft: SymbolDraft): Promise<SymbolDraft> => {
    const isNew = !draft.id;
    const response = await fetch(
      isNew ? '/api/settings/symbols' : `/api/settings/symbols/${draft.id}`,
      {
        method: isNew ? 'POST' : 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(draft),
      }
    );

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = (await response.json()) as { symbol: ApiSymbol };
    return mapApiSymbolToDraft(payload.symbol);
  };

  const saveExistingSymbol = async (draft: SymbolDraft) => {
    if (!draft.id) {
      return;
    }

    setSavingKey(draft.id);

    try {
      const saved = await persistSymbol(draft);
      setSymbols((current) =>
        sortBySymbol(
          current.map((symbol) => (symbol.id === saved.id ? saved : symbol))
        )
      );
      setSymbolStatus((current) => ({
        ...current,
        [draft.id!]: 'Saved.',
      }));
    } catch (error) {
      setSymbolStatus((current) => ({
        ...current,
        [draft.id!]: error instanceof Error ? error.message : 'Save failed.',
      }));
    } finally {
      setSavingKey(null);
    }
  };

  const createSymbol = async () => {
    setSavingKey('new');

    try {
      const saved = await persistSymbol(newSymbol);
      setSymbols((current) => sortBySymbol([...current, saved]));
      setNewSymbol(cloneDraft(defaults));
      setActiveSymbolId(null);
      setSymbolStatus((current) => ({
        ...current,
        new: `${saved.symbol} added.`,
      }));
    } catch (error) {
      setSymbolStatus((current) => ({
        ...current,
        new: error instanceof Error ? error.message : 'Create failed.',
      }));
    } finally {
      setSavingKey(null);
    }
  };

  const updateExchangeDraft = <TKey extends keyof ExchangeDraft>(
    exchange: ManagedExchange,
    key: TKey,
    value: ExchangeDraft[TKey]
  ) => {
    setExchangeDrafts((current) => ({
      ...current,
      [exchange]: {
        ...current[exchange],
        [key]: value,
      },
    }));
  };

  const saveExchangeAccount = async (exchange: ManagedExchange) => {
    setExchangeSavingKey(exchange);

    try {
      const response = await fetch(`/api/settings/exchanges/${exchange}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(exchangeDrafts[exchange]),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as { account: ExchangeAccount };
      setExchangeAccounts((current) => ({
        ...current,
        [exchange]: payload.account,
      }));
      setExchangeDrafts((current) => ({
        ...current,
        [exchange]: { ...EMPTY_EXCHANGE_DRAFT },
      }));
      setExchangeStatus((current) => ({
        ...current,
        [exchange]: 'Credentials saved.',
      }));
    } catch (error) {
      setExchangeStatus((current) => ({
        ...current,
        [exchange]:
          error instanceof Error ? error.message : 'Credential save failed.',
      }));
    } finally {
      setExchangeSavingKey(null);
    }
  };

  const runExchangeAction = async (
    exchange: ManagedExchange,
    action: 'sync-positions' | 'apply-stop-losses',
    successMessage: (payload: {
      syncedAt?: string | null;
      validatedAt?: string | null;
      summary?: { openCount?: number; linkedCount?: number; closedCount?: number };
      updated?: number;
    }) => string
  ) => {
    setExchangeSavingKey(exchange);

    try {
      const response = await fetch(`/api/settings/exchanges/${exchange}/${action}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as {
        syncedAt?: string | null;
        validatedAt?: string | null;
        summary?: { openCount?: number; linkedCount?: number; closedCount?: number };
        updated?: number;
      };

      setExchangeAccounts((current) => ({
        ...current,
        [exchange]: {
          ...current[exchange],
          lastValidatedAt:
            payload.validatedAt ?? payload.syncedAt ?? current[exchange].lastValidatedAt,
          lastSyncAt: payload.syncedAt ?? current[exchange].lastSyncAt,
          lastSyncError: null,
        },
      }));
      setExchangeStatus((current) => ({
        ...current,
        [exchange]: successMessage(payload),
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Exchange action failed.';
      setExchangeAccounts((current) => ({
        ...current,
        [exchange]: {
          ...current[exchange],
          lastSyncError: message,
        },
      }));
      setExchangeStatus((current) => ({
        ...current,
        [exchange]: message,
      }));
    } finally {
      setExchangeSavingKey(null);
    }
  };

  const subscribe = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('Push notifications are not supported in this browser.');
      return;
    }

    if (!vapidPublicKey) {
      setStatus('The backend is missing VAPID configuration.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      setStatus('Notification permission was not granted.');
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        vapidPublicKey
      ) as BufferSource,
    });

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subscription,
        eventFilters: ['entry', 'exit', 'runner_error'],
      }),
    });

    if (!response.ok) {
      setStatus('Subscription failed.');
      return;
    }

    setStatus('Subscribed to push notifications.');
  };

  const unsubscribe = async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      setStatus('No active subscription found.');
      return;
    }

    const response = await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
      }),
    });

    if (!response.ok) {
      setStatus('Unsubscribe failed.');
      return;
    }

    await subscription.unsubscribe();
    setStatus('Push notifications disabled.');
  };

  return (
    <div className="stack-lg">
      <section className="card settings-shell">
        <div className="settings-toolbar">
          <div>
            <h2>Settings</h2>
            <p className="muted">
              Manage symbol configurations and web push delivery for the runner.
            </p>
          </div>
        </div>
        <div
          aria-label="Settings sections"
          className="settings-tablist"
          role="tablist"
        >
          <button
            aria-controls="settings-panel-symbols"
            aria-selected={activeTab === 'symbols'}
            className={
              activeTab === 'symbols'
                ? 'settings-tab settings-tab-active'
                : 'settings-tab'
            }
            id="settings-tab-symbols"
            onClick={() => setActiveTab('symbols')}
            role="tab"
            type="button"
          >
            Symbols
          </button>
          <button
            aria-controls="settings-panel-exchanges"
            aria-selected={activeTab === 'exchanges'}
            className={
              activeTab === 'exchanges'
                ? 'settings-tab settings-tab-active'
                : 'settings-tab'
            }
            id="settings-tab-exchanges"
            onClick={() => setActiveTab('exchanges')}
            role="tab"
            type="button"
          >
            Exchanges
          </button>
          <button
            aria-controls="settings-panel-pushes"
            aria-selected={activeTab === 'pushes'}
            className={
              activeTab === 'pushes'
                ? 'settings-tab settings-tab-active'
                : 'settings-tab'
            }
            id="settings-tab-pushes"
            onClick={() => setActiveTab('pushes')}
            role="tab"
            type="button"
          >
            Pushes
          </button>
        </div>
        <p className="muted">
          {activeTab === 'symbols'
            ? 'Symbols now own their exchange, strategy, execution, and risk settings directly in the database. Changes here are what the runner will use.'
            : activeTab === 'exchanges'
              ? 'Store Bybit and OKX credentials, import live positions, and push stop-loss protection to synced exchange positions.'
              : 'Approved signals across all symbols arrive as web push alerts.'}
        </p>
        {apiUnavailable ? (
          <p className="status-line">
            Settings are temporarily degraded while the backend API reconnects.
          </p>
        ) : null}
      </section>

      {activeTab === 'symbols' ? (
        <div
          aria-labelledby="settings-tab-symbols"
          id="settings-panel-symbols"
          role="tabpanel"
        >
          <section className="card settings-symbols-panel">
            <div className="settings-symbols-toolbar">
              <div>
                <h2>Symbols</h2>
                <p className="muted">
                  Pick a symbol to edit its configuration, or add a new one.
                </p>
              </div>
              <button
                className="primary-button"
                onClick={() => setActiveSymbolId(NEW_SYMBOL_MODAL_ID)}
                type="button"
              >
                {hasUnsavedNewSymbol ? 'Continue Unsaved Symbol' : 'Add Symbol'}
              </button>
            </div>

            {symbolStatus.new ? (
              <p className="status-line">{symbolStatus.new}</p>
            ) : null}

            {symbols.length === 0 ? (
              <p className="muted">No symbols are configured yet.</p>
            ) : (
              <div className="symbol-list" role="list">
                {symbols.map((symbol) => (
                  <button
                    className="symbol-list-item"
                    key={symbol.id}
                    onClick={() => setActiveSymbolId(symbol.id ?? null)}
                    type="button"
                  >
                    <span className="symbol-list-main">
                      <span className="symbol-list-title-row">
                        <strong>{symbol.symbol}</strong>
                        <span
                          className={symbol.active ? 'pill' : 'pill pill-warn'}
                        >
                          {symbol.active ? 'Active' : 'Paused'}
                        </span>
                      </span>
                      <span className="symbol-list-meta">
                        {symbol.exchange.toUpperCase()} · {symbol.timeframe} ·{' '}
                        {symbol.allowShort ? 'Short enabled' : 'Long only'}
                      </span>
                    </span>
                    <span className="symbol-list-action">Edit</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {activeSymbolDraft ? (
            <div
              aria-modal="true"
              className="settings-modal-backdrop"
              onClick={() => setActiveSymbolId(null)}
              role="dialog"
            >
              <div
                className="settings-modal"
                onClick={(event) => event.stopPropagation()}
              >
                <SymbolEditor
                  title={activeSymbolTitle}
                  submitLabel={
                    activeSymbolId === NEW_SYMBOL_MODAL_ID
                      ? 'Add Symbol'
                      : 'Save Settings'
                  }
                  status={activeSymbolStatus}
                  saving={savingKey === activeSymbolId}
                  draft={activeSymbolDraft}
                  onChange={(key, value) => {
                    if (activeSymbolId === NEW_SYMBOL_MODAL_ID) {
                      updateNewSymbol(key, value);
                      return;
                    }

                    if (!activeSymbolId) {
                      return;
                    }

                    updateSymbolDraft(activeSymbolId, key, value);
                  }}
                  onClose={() => setActiveSymbolId(null)}
                  onSubmit={() => {
                    if (activeSymbolId === NEW_SYMBOL_MODAL_ID) {
                      void createSymbol();
                      return;
                    }

                    void saveExistingSymbol(activeSymbolDraft);
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : activeTab === 'exchanges' ? (
        <div
          aria-labelledby="settings-tab-exchanges"
          className="stack-lg"
          id="settings-panel-exchanges"
          role="tabpanel"
        >
          {MANAGED_EXCHANGES.map((exchange) => (
            <ExchangePanel
              account={exchangeAccounts[exchange]}
              draft={exchangeDrafts[exchange]}
              key={exchange}
              onApplyStopLosses={() =>
                void runExchangeAction(
                  exchange,
                  'apply-stop-losses',
                  (payload) =>
                    payload.updated
                      ? `Stop losses pushed for ${payload.updated} position${payload.updated === 1 ? '' : 's'}.`
                      : 'No matching live positions needed updates.'
                )
              }
              onChange={(key, value) =>
                updateExchangeDraft(exchange, key, value)
              }
              onSave={() => void saveExchangeAccount(exchange)}
              onSync={() =>
                void runExchangeAction(
                  exchange,
                  'sync-positions',
                  (payload) => {
                    const openCount = payload.summary?.openCount ?? 0;
                    const linkedCount = payload.summary?.linkedCount ?? 0;
                    return `Synced ${openCount} open position${openCount === 1 ? '' : 's'}${linkedCount > 0 ? `, ${linkedCount} linked to app positions` : ''}.`;
                  }
                )
              }
              saving={exchangeSavingKey === exchange}
              status={exchangeStatus[exchange]}
            />
          ))}
        </div>
      ) : (
        <section
          aria-labelledby="settings-tab-pushes"
          className="card"
          id="settings-panel-pushes"
          role="tabpanel"
        >
          <h2>Push Notifications</h2>
          <p className="muted">
            Subscribe this device to receive entry, exit, and runner error
            alerts.
          </p>
          <div className="button-row">
            <button
              className="primary-button"
              onClick={() => void subscribe()}
              type="button"
            >
              Subscribe
            </button>
            <button
              className="secondary-button"
              onClick={() => void unsubscribe()}
              type="button"
            >
              Unsubscribe
            </button>
          </div>
          <p className="status-line">{status}</p>
        </section>
      )}
    </div>
  );
}
