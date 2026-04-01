'use client';

import { useState } from 'react';

type ApiSymbol = {
  id: string;
  exchange: 'bybit' | 'binance';
  exchange_timeout_ms: number;
  exchange_rate_limit_ms: number;
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
  max_daily_drawdown_pct: number;
  max_consecutive_losses: number;
  poll_interval_ms: number;
  active: boolean;
};

type SymbolDraft = {
  id?: string;
  symbol: string;
  active: boolean;
  exchange: 'bybit' | 'binance';
  exchangeTimeoutMs: number;
  exchangeRateLimitMs: number;
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
  maxDailyDrawdownPct: number;
  maxConsecutiveLosses: number;
  pollIntervalMs: number;
};

type SettingsClientProps = {
  apiUnavailable: boolean;
  vapidPublicKey: string;
  symbols: ApiSymbol[];
  defaults: SymbolDraft;
};

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
  maxDailyDrawdownPct: symbol.max_daily_drawdown_pct,
  maxConsecutiveLosses: symbol.max_consecutive_losses,
  pollIntervalMs: symbol.poll_interval_ms,
});

const cloneDraft = (draft: SymbolDraft): SymbolDraft => ({ ...draft });

const sortBySymbol = (symbols: SymbolDraft[]): SymbolDraft[] =>
  [...symbols].sort((left, right) => left.symbol.localeCompare(right.symbol));

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
  onSubmit: () => void;
};

function SymbolEditor({
  title,
  submitLabel,
  status,
  saving,
  draft,
  onChange,
  onSubmit,
}: SymbolEditorProps) {
  return (
    <section className="card stack-lg">
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
            <span>Exchange</span>
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
              <option value="binance">Binance</option>
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

      <div className="button-row">
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

export function SettingsClient({
  apiUnavailable,
  vapidPublicKey,
  symbols: initialSymbols,
  defaults,
}: SettingsClientProps) {
  const [status, setStatus] = useState<string>('Idle');
  const [symbols, setSymbols] = useState<SymbolDraft[]>(
    sortBySymbol(initialSymbols.map(mapApiSymbolToDraft))
  );
  const [newSymbol, setNewSymbol] = useState<SymbolDraft>(() =>
    cloneDraft(defaults)
  );
  const [symbolStatus, setSymbolStatus] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

  const logout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
    });
    window.location.href = '/login';
  };

  return (
    <div className="stack-lg">
      <section className="card">
        <h2>Symbol Settings</h2>
        <p className="muted">
          Symbols now own their exchange, strategy, execution, and risk settings
          directly in the database. Changes here are what the runner will use.
        </p>
        {apiUnavailable ? (
          <p className="status-line">
            Settings are temporarily degraded while the backend API reconnects.
          </p>
        ) : null}
      </section>

      <SymbolEditor
        title="Add Symbol"
        submitLabel="Add Symbol"
        status={symbolStatus.new}
        saving={savingKey === 'new'}
        draft={newSymbol}
        onChange={updateNewSymbol}
        onSubmit={() => void createSymbol()}
      />

      {symbols.length === 0 ? (
        <section className="card">
          <p className="muted">No symbols are configured yet.</p>
        </section>
      ) : null}

      {symbols.map((symbol) => (
        <SymbolEditor
          key={symbol.id}
          title="Configured Symbol"
          submitLabel="Save Settings"
          status={symbol.id ? symbolStatus[symbol.id] : undefined}
          saving={savingKey === symbol.id}
          draft={symbol}
          onChange={(key, value) => {
            if (!symbol.id) {
              return;
            }

            updateSymbolDraft(symbol.id, key, value);
          }}
          onSubmit={() => void saveExistingSymbol(symbol)}
        />
      ))}

      <section className="card">
        <h2>Push Notifications</h2>
        <p className="muted">
          Approved signals across all symbols arrive as web push alerts.
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
          <button
            className="secondary-button"
            onClick={() => void logout()}
            type="button"
          >
            Sign Out
          </button>
        </div>
        <p className="status-line">{status}</p>
      </section>
    </div>
  );
}
