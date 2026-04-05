'use client';

import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tabs,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { Eyebrow, StatusTag } from '@/components/ui-primitives.tsx';

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

type Option<TValue extends string> = {
  label: string;
  value: TValue;
};

const MARKET_EXCHANGE_OPTIONS: Option<SymbolDraft['exchange']>[] = [
  { label: 'Bybit', value: 'bybit' },
  { label: 'OKX', value: 'okx' },
  { label: 'Binance (legacy)', value: 'binance' },
];

const BROKER_OPTIONS: Option<SymbolDraft['positionBroker']>[] = [
  { label: 'Bybit', value: 'bybit' },
  { label: 'OKX', value: 'okx' },
];

const TIMEFRAME_OPTIONS: Option<SymbolDraft['timeframe']>[] = [
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
];

const FILL_MODEL_OPTIONS: Option<SymbolDraft['fillModel']>[] = [
  { label: 'next_open', value: 'next_open' },
];

const POSITION_SIZING_OPTIONS: Option<SymbolDraft['positionSizingMode']>[] = [
  { label: 'fixed_usdt', value: 'fixed_usdt' },
];

const TRAILING_PROFILE_OPTIONS: Option<TrailingProfile>[] = [
  { label: 'Conservative', value: 'conservative' },
  { label: 'Balanced (recommended)', value: 'balanced' },
  { label: 'Aggressive', value: 'aggressive' },
  { label: 'Custom', value: 'custom' },
];

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

function SectionCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <Card
      className="surface-card settings-section-card"
      styles={{ body: { padding: 16 } }}
    >
      <h3>{title}</h3>
      {children}
    </Card>
  );
}

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
  const updateNumber =
    <TKey extends keyof SymbolDraft>(key: TKey) =>
    (value: number | null) => {
      onChange(key, Number(value ?? 0) as SymbolDraft[TKey]);
    };

  return (
    <div className="stack-lg">
      <div className="settings-head">
        <div>
          <Eyebrow>{title}</Eyebrow>
          <h2>{draft.symbol || 'Unsaved symbol'}</h2>
        </div>
        <StatusTag tone={draft.active ? 'success' : 'warning'}>
          {draft.active ? 'Active' : 'Paused'}
        </StatusTag>
      </div>

      <Form layout="vertical">
        <div className="stack-lg">
          <SectionCard title="Market">
            <div className="field-grid">
              <Form.Item label="Symbol">
                <Input
                  onChange={(event) => onChange('symbol', event.target.value)}
                  placeholder="BTC/USDT"
                  value={draft.symbol}
                />
              </Form.Item>
              <Form.Item label="Market Data Exchange">
                <Select
                  className="full-width-control"
                  onChange={(value) => onChange('exchange', value)}
                  options={MARKET_EXCHANGE_OPTIONS}
                  value={draft.exchange}
                />
              </Form.Item>
              <Form.Item label="Position Broker">
                <Select
                  className="full-width-control"
                  onChange={(value) => onChange('positionBroker', value)}
                  options={BROKER_OPTIONS}
                  value={draft.positionBroker}
                />
              </Form.Item>
              <Form.Item label="Counter Position Broker">
                <Select
                  className="full-width-control"
                  onChange={(value) => onChange('counterPositionBroker', value)}
                  options={BROKER_OPTIONS}
                  value={draft.counterPositionBroker}
                />
              </Form.Item>
              <Form.Item label="Timeframe">
                <Select
                  className="full-width-control"
                  onChange={(value) => onChange('timeframe', value)}
                  options={TIMEFRAME_OPTIONS}
                  value={draft.timeframe}
                />
              </Form.Item>
              <Form.Item label="Poll Interval (ms)">
                <InputNumber
                  className="full-width-control"
                  min={100}
                  onChange={updateNumber('pollIntervalMs')}
                  value={draft.pollIntervalMs}
                />
              </Form.Item>
              <Form.Item label="Exchange Timeout (ms)">
                <InputNumber
                  className="full-width-control"
                  min={1}
                  onChange={updateNumber('exchangeTimeoutMs')}
                  value={draft.exchangeTimeoutMs}
                />
              </Form.Item>
              <Form.Item label="Exchange Rate Limit (ms)">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('exchangeRateLimitMs')}
                  value={draft.exchangeRateLimitMs}
                />
              </Form.Item>
            </div>
            <div className="toggle-grid">
              <div className="toggle-row">
                <Switch
                  checked={draft.active}
                  onChange={(checked) => onChange('active', checked)}
                />
                <span>Active</span>
              </div>
              <div className="toggle-row">
                <Switch
                  checked={draft.dryRun}
                  onChange={(checked) => onChange('dryRun', checked)}
                />
                <span>Dry Run</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Strategy">
            <div className="field-grid">
              <Form.Item label="Strategy Key">
                <Input
                  onChange={(event) =>
                    onChange('strategyKey', event.target.value)
                  }
                  value={draft.strategyKey}
                />
              </Form.Item>
              <Form.Item label="Strategy Version">
                <Input
                  onChange={(event) =>
                    onChange('strategyVersion', event.target.value)
                  }
                  value={draft.strategyVersion}
                />
              </Form.Item>
              <Form.Item
                label="Signal N"
                tooltip="Lookback window size (N). Number of bars used to compute the baseline volatility B_t. Default is 96 bars (8 hours on 5m)."
              >
                <InputNumber
                  className="full-width-control"
                  min={1}
                  onChange={updateNumber('signalN')}
                  value={draft.signalN}
                />
              </Form.Item>
              <Form.Item
                label="Signal K"
                tooltip="Threshold multiplier (K). The current return r_t must exceed K × B_t to trigger an entry signal. Higher values require stronger moves."
              >
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('signalK')}
                  step={0.1}
                  value={draft.signalK}
                />
              </Form.Item>
              <Form.Item
                label="Signal Hold Bars"
                tooltip="Hold duration (H). Number of bars to hold a position before the time-based exit triggers. Default is 72 bars (6 hours on 5m)."
              >
                <InputNumber
                  className="full-width-control"
                  min={1}
                  onChange={updateNumber('signalHBars')}
                  value={draft.signalHBars}
                />
              </Form.Item>
            </div>
            <div className="toggle-grid">
              <div className="toggle-row">
                <Switch
                  checked={draft.allowShort}
                  onChange={(checked) => onChange('allowShort', checked)}
                />
                <span>Allow Short</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Execution">
            <div className="field-grid">
              <Form.Item label="Fill Model">
                <Select
                  className="full-width-control"
                  onChange={(value) => onChange('fillModel', value)}
                  options={FILL_MODEL_OPTIONS}
                  value={draft.fillModel}
                />
              </Form.Item>
              <Form.Item label="Position Sizing">
                <Select
                  className="full-width-control"
                  onChange={(value) => onChange('positionSizingMode', value)}
                  options={POSITION_SIZING_OPTIONS}
                  value={draft.positionSizingMode}
                />
              </Form.Item>
              <Form.Item label="Fee Rate">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('feeRate')}
                  step={0.0001}
                  value={draft.feeRate}
                />
              </Form.Item>
              <Form.Item label="Slippage (bps)">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('slippageBps')}
                  step={0.1}
                  value={draft.slippageBps}
                />
              </Form.Item>
              <Form.Item label="Fixed USDT Per Trade">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('fixedUsdtPerTrade')}
                  step={1}
                  value={draft.fixedUsdtPerTrade}
                />
              </Form.Item>
              <Form.Item label="Equity Start (USDT)">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('equityStartUsdt')}
                  step={1}
                  value={draft.equityStartUsdt}
                />
              </Form.Item>
            </div>
          </SectionCard>

          <SectionCard title="Risk">
            <div className="field-grid">
              <Form.Item label="Max Open Positions">
                <InputNumber
                  className="full-width-control"
                  min={1}
                  onChange={updateNumber('maxOpenPositions')}
                  value={draft.maxOpenPositions}
                />
              </Form.Item>
              <Form.Item label="Cooldown Bars">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('cooldownBars')}
                  value={draft.cooldownBars}
                />
              </Form.Item>
              <Form.Item label="Stop Loss %">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('stopLossPct')}
                  step={0.1}
                  value={draft.stopLossPct}
                />
              </Form.Item>
              <Form.Item label="Max Daily Drawdown %">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('maxDailyDrawdownPct')}
                  step={0.1}
                  value={draft.maxDailyDrawdownPct}
                />
              </Form.Item>
              <Form.Item label="Max Consecutive Losses">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={updateNumber('maxConsecutiveLosses')}
                  value={draft.maxConsecutiveLosses}
                />
              </Form.Item>
            </div>
          </SectionCard>

          <SectionCard title="Exit / Trailing Profit">
            <div className="toggle-grid">
              <div className="toggle-row">
                <Switch
                  checked={draft.trailingEnabled}
                  onChange={(checked) => onChange('trailingEnabled', checked)}
                />
                <span>Trailing Profit Enabled</span>
              </div>
            </div>
            <div className="field-grid">
              <Form.Item label="Profile">
                <Select
                  className="full-width-control"
                  onChange={(value) => handleProfileChange(value, onChange)}
                  options={TRAILING_PROFILE_OPTIONS}
                  value={draft.trailingProfile}
                />
              </Form.Item>
              <Form.Item label="Activation Profit %">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={(value) => {
                    updateNumber('trailingActivationProfitPct')(value);
                    onChange('trailingProfile', 'custom');
                  }}
                  step={0.1}
                  value={draft.trailingActivationProfitPct}
                />
              </Form.Item>
              <Form.Item label="Giveback Ratio">
                <InputNumber
                  className="full-width-control"
                  max={1}
                  min={0}
                  onChange={(value) => {
                    updateNumber('trailingGivebackRatio')(value);
                    onChange('trailingProfile', 'custom');
                  }}
                  step={0.01}
                  value={draft.trailingGivebackRatio}
                />
              </Form.Item>
              <Form.Item label="Giveback Min %">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={(value) => {
                    updateNumber('trailingGivebackMinPct')(value);
                    onChange('trailingProfile', 'custom');
                  }}
                  step={0.1}
                  value={draft.trailingGivebackMinPct}
                />
              </Form.Item>
              <Form.Item label="Giveback Max %">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={(value) => {
                    updateNumber('trailingGivebackMaxPct')(value);
                    onChange('trailingProfile', 'custom');
                  }}
                  step={0.1}
                  value={draft.trailingGivebackMaxPct}
                />
              </Form.Item>
              <Form.Item label="Min Locked Profit %">
                <InputNumber
                  className="full-width-control"
                  min={0}
                  onChange={(value) => {
                    updateNumber('trailingMinLockedProfitPct')(value);
                    onChange('trailingProfile', 'custom');
                  }}
                  step={0.1}
                  value={draft.trailingMinLockedProfitPct}
                />
              </Form.Item>
            </div>
          </SectionCard>
        </div>
      </Form>

      <div className="button-row">
        <Button onClick={onClose}>Close</Button>
        <Button loading={saving} onClick={onSubmit} type="primary">
          {submitLabel}
        </Button>
      </div>
      <p className="status-line">{status ?? ' '}</p>
    </div>
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
    <Card
      className="surface-card exchange-panel"
      styles={{ body: { padding: 20 } }}
    >
      <div className="settings-head">
        <div>
          <Eyebrow>Exchange Integration</Eyebrow>
          <h2>{account.exchange === 'bybit' ? 'Bybit' : 'OKX'}</h2>
        </div>
        <StatusTag
          tone={
            account.hasApiKey && account.hasApiSecret ? 'success' : 'warning'
          }
        >
          {account.hasApiKey && account.hasApiSecret
            ? 'Credentials Stored'
            : 'Credentials Missing'}
        </StatusTag>
      </div>

      <Form layout="vertical">
        <div className="stack-lg">
          <SectionCard title="Credentials">
            <div className="field-grid">
              <Form.Item label="API Key">
                <Input
                  onChange={(event) => onChange('apiKey', event.target.value)}
                  placeholder={account.apiKeyMask ?? 'Paste a new API key'}
                  value={draft.apiKey}
                />
              </Form.Item>
              <Form.Item label="API Secret">
                <Input
                  onChange={(event) =>
                    onChange('apiSecret', event.target.value)
                  }
                  placeholder={
                    account.hasApiSecret
                      ? 'Stored. Enter to replace.'
                      : 'Paste a new API secret'
                  }
                  type="password"
                  value={draft.apiSecret}
                />
              </Form.Item>
              {account.exchange === 'okx' ? (
                <Form.Item label="Passphrase">
                  <Input
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
                </Form.Item>
              ) : null}
            </div>
            <div className="button-row">
              <Button loading={saving} onClick={onSave} type="primary">
                Save Credentials
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Position Sync">
            <div className="signal-grid">
              <Card
                className="surface-card signal-field-card"
                styles={{ body: { padding: 14 } }}
              >
                <span className="signal-field-label">Last Validation</span>
                <strong>{formatTimestamp(account.lastValidatedAt)}</strong>
              </Card>
              <Card
                className="surface-card signal-field-card"
                styles={{ body: { padding: 14 } }}
              >
                <span className="signal-field-label">Last Position Sync</span>
                <strong>{formatTimestamp(account.lastSyncAt)}</strong>
              </Card>
              <Card
                className="surface-card signal-field-card"
                styles={{ body: { padding: 14 } }}
              >
                <span className="signal-field-label">Latest Result</span>
                <strong>{account.lastSyncError ?? 'Healthy'}</strong>
              </Card>
            </div>
            <div className="button-row">
              <Button onClick={onSync}>Sync Open Positions</Button>
              <Button onClick={onApplyStopLosses}>Apply Stop Losses</Button>
            </div>
          </SectionCard>
        </div>
      </Form>

      <p className="status-line">{status ?? ' '}</p>
    </Card>
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
      : (symbols.find((symbol) => symbol.id === activeSymbolId) ?? null);

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
      summary?: {
        openCount?: number;
        linkedCount?: number;
        closedCount?: number;
      };
      updated?: number;
    }) => string
  ) => {
    setExchangeSavingKey(exchange);

    try {
      const response = await fetch(
        `/api/settings/exchanges/${exchange}/${action}`,
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as {
        syncedAt?: string | null;
        validatedAt?: string | null;
        summary?: {
          openCount?: number;
          linkedCount?: number;
          closedCount?: number;
        };
        updated?: number;
      };

      setExchangeAccounts((current) => ({
        ...current,
        [exchange]: {
          ...current[exchange],
          lastValidatedAt:
            payload.validatedAt ??
            payload.syncedAt ??
            current[exchange].lastValidatedAt,
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

  const description =
    activeTab === 'symbols'
      ? 'Symbols now own their exchange, strategy, execution, and risk settings directly in the database. Changes here are what the runner will use.'
      : activeTab === 'exchanges'
        ? 'Store Bybit and OKX credentials, import live positions, and push stop-loss protection to synced exchange positions.'
        : 'Approved signals across all symbols arrive as web push alerts.';

  return (
    <div className="stack-lg">
      <Card
        className="surface-card settings-shell"
        styles={{ body: { padding: 20 } }}
      >
        <div className="settings-toolbar">
          <div>
            <h2>Settings</h2>
            <p className="muted">
              Manage symbol configurations and web push delivery for the runner.
            </p>
          </div>
        </div>
        <Tabs
          activeKey={activeTab}
          className="settings-tabs"
          items={[
            { key: 'symbols', label: 'Symbols' },
            { key: 'exchanges', label: 'Exchanges' },
            { key: 'pushes', label: 'Pushes' },
          ]}
          onChange={(key) => setActiveTab(key as SettingsTab)}
        />
        <p className="muted">{description}</p>
        {apiUnavailable ? (
          <Alert
            description="Settings are temporarily degraded while the backend API reconnects."
            showIcon
            type="warning"
          />
        ) : null}
      </Card>

      {activeTab === 'symbols' ? (
        <Card
          className="surface-card settings-symbols-panel"
          styles={{ body: { padding: 20 } }}
        >
          <div className="settings-symbols-toolbar">
            <div>
              <h2>Symbols</h2>
              <p className="muted">
                Pick a symbol to edit its configuration, or add a new one.
              </p>
            </div>
            <Button
              onClick={() => setActiveSymbolId(NEW_SYMBOL_MODAL_ID)}
              type="primary"
            >
              {hasUnsavedNewSymbol ? 'Continue Unsaved Symbol' : 'Add Symbol'}
            </Button>
          </div>

          {symbolStatus.new ? (
            <p className="status-line">{symbolStatus.new}</p>
          ) : null}

          {symbols.length === 0 ? (
            <Empty
              description="No symbols are configured yet."
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <div className="symbol-list">
              {symbols.map((symbol) => (
                <Card
                  className="surface-card symbol-list-item-card"
                  extra={
                    <Button
                      onClick={() => setActiveSymbolId(symbol.id ?? null)}
                      type="default"
                    >
                      Edit
                    </Button>
                  }
                  key={symbol.id}
                  styles={{ body: { padding: 18 } }}
                >
                  <div className="symbol-list-main">
                    <div className="symbol-list-title-row">
                      <strong>{symbol.symbol}</strong>
                      <StatusTag tone={symbol.active ? 'success' : 'warning'}>
                        {symbol.active ? 'Active' : 'Paused'}
                      </StatusTag>
                    </div>
                    <span className="symbol-list-meta">
                      {symbol.exchange.toUpperCase()} · {symbol.timeframe} ·{' '}
                      {symbol.allowShort ? 'Short enabled' : 'Long only'}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Modal
            footer={null}
            onCancel={() => setActiveSymbolId(null)}
            open={Boolean(activeSymbolDraft)}
            width={980}
          >
            {activeSymbolDraft ? (
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
            ) : null}
          </Modal>
        </Card>
      ) : activeTab === 'exchanges' ? (
        <div className="stack-lg">
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
        <Card className="surface-card" styles={{ body: { padding: 20 } }}>
          <h2>Push Notifications</h2>
          <p className="muted">
            Subscribe this device to receive entry, exit, and runner error
            alerts.
          </p>
          <div className="button-row">
            <Button onClick={() => void subscribe()} type="primary">
              Subscribe
            </Button>
            <Button onClick={() => void unsubscribe()}>Unsubscribe</Button>
          </div>
          <p className="status-line">{status}</p>
        </Card>
      )}
    </div>
  );
}
