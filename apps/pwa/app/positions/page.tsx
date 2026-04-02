import { Suspense } from 'react';

import { CandleChart } from '@/components/candle-chart.tsx';
import { ExchangeBadge } from '@/components/exchange-badge.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';

export const dynamic = 'force-dynamic';

type PositionPageCandle = {
  close: number;
  closeTime: string;
  high: number;
  low: number;
  open: number;
};

type PositionPageItem = {
  broker: 'bybit' | 'okx';
  entry_price: number;
  entry_time: string;
  id: string;
  is_counter_position: boolean;
  last_synced_at: string | null;
  linked_position_id: string | null;
  notional_usdt: number;
  position_source: 'simulated' | 'exchange';
  qty: number;
  side: 'LONG' | 'SHORT';
  stop_loss_price: number | null;
  symbol: string;
  supports_trailing: boolean;
  unrealized_pnl: number | null;
  trailing_profile: string;
  trailing_enabled: boolean;
  trailing_activation_profit_pct: number;
  trailing_giveback_ratio: number;
  trailing_giveback_min_pct: number;
  trailing_giveback_max_pct: number;
  trailing_min_locked_profit_pct: number;
  trailing_armed: boolean;
  trailing_current_profit_pct: number | null;
  trailing_peak_profit_pct: number | null;
  trailing_giveback_pct: number | null;
  trailing_allowed_giveback_pct: number | null;
};

const formatSignedValue = (value: number | null): string =>
  value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(4)}`;

const formatUsdtValue = (value: number): string => `${value.toFixed(2)} USDT`;

const getSideClassName = (side: PositionPageItem['side']): string =>
  side === 'LONG' ? 'pill' : 'pill pill-warn';

const formatProfileLabel = (profile: string): string => {
  const labels: Record<string, string> = {
    conservative: 'Conservative',
    balanced: 'Balanced',
    aggressive: 'Aggressive',
    custom: 'Custom',
  };
  return labels[profile] ?? profile;
};

const formatPct = (value: number): string => `${value.toFixed(2)}%`;

const formatRatio = (value: number): string => value.toFixed(2);

const formatRate = (value: number | null): string =>
  value === null ? 'n/a' : value.toFixed(4);

const getTrailingTakeProfitRate = (
  position: PositionPageItem
): number | null => {
  if (
    !position.trailing_enabled ||
    !position.trailing_armed ||
    position.trailing_peak_profit_pct === null ||
    position.trailing_allowed_giveback_pct === null
  ) {
    return null;
  }

  const triggerProfitPct = Math.max(
    position.trailing_min_locked_profit_pct,
    position.trailing_peak_profit_pct - position.trailing_allowed_giveback_pct
  );

  const multiplier =
    position.side === 'LONG'
      ? 1 + triggerProfitPct / 100
      : 1 - triggerProfitPct / 100;

  return position.entry_price * multiplier;
};

function PositionOverviewTable({ position }: { position: PositionPageItem }) {
  return (
    <div className="signal-grid">
      <div className="signal-field">
        <span className="signal-field-label">Entry Time</span>
        <strong>{formatDateTime(position.entry_time)}</strong>
      </div>
      <div className="signal-field">
        <span className="signal-field-label">Entry Price</span>
        <strong>{position.entry_price.toFixed(4)}</strong>
      </div>
      <div className="signal-field">
        <span className="signal-field-label">Qty</span>
        <strong>{position.qty.toFixed(6)}</strong>
      </div>
      <div className="signal-field">
        <span className="signal-field-label">Amount</span>
        <strong>{formatUsdtValue(position.notional_usdt)}</strong>
      </div>
      <div className="signal-field">
        <span className="signal-field-label">Unrealized PnL</span>
        <strong>{formatSignedValue(position.unrealized_pnl)}</strong>
      </div>
      <div className="signal-field">
        <span className="signal-field-label">Position Type</span>
        <strong>{position.is_counter_position ? 'Counter' : 'Primary'}</strong>
      </div>
      <div className="signal-field">
        <span className="signal-field-label">Exchange</span>
        <strong className="position-field-badge">
          <ExchangeBadge exchange={position.broker} />
        </strong>
      </div>
    </div>
  );
}

function PositionChartFallback() {
  return (
    <div className="signal-chart signal-chart-empty">
      <div className="signal-chart-head">
        <span>Latest 360 min</span>
        <span>Loading</span>
      </div>
      <p className="muted">Loading live candles for this position.</p>
    </div>
  );
}

async function PositionChart({
  entryPrice,
  positionId,
  symbol,
}: {
  entryPrice: number;
  positionId: string;
  symbol: string;
}) {
  const { data, unavailable } = await fetchApiWithFallback<{
    recent_candles: PositionPageCandle[];
  }>(`/positions/${positionId}/candles`, {
    recent_candles: [],
  });

  return (
    <CandleChart
      ariaLabel={`Real-time candlestick chart for the latest 360 minutes on ${symbol}`}
      candles={data.recent_candles}
      emptyMessage={
        unavailable
          ? 'Real-time candles are temporarily unavailable while the backend API reconnects.'
          : 'Real-time candles are temporarily unavailable for this position.'
      }
      footerLabel="Live exchange candles"
      summary={`${data.recent_candles.length}/24 candles`}
      referencePrice={entryPrice}
      title="Latest 360 min"
    />
  );
}

const formatSignedPct = (value: number | null): string => {
  if (value === null) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

function TrailingDetails({ position }: { position: PositionPageItem }) {
  const armed = position.trailing_armed;
  const statusLabel = !position.trailing_enabled
    ? 'Disabled'
    : armed
      ? 'Armed'
      : 'Not Armed';
  const trailingTakeProfitRate = getTrailingTakeProfitRate(position);

  return (
    <details className="position-subcard">
      <summary className="position-subsummary">
        <span className="position-subhead">
          <h4>Trailing Profit</h4>
          {!position.trailing_enabled ? (
            <span className="pill pill-warn">Disabled</span>
          ) : armed ? (
            <span className="pill">Armed</span>
          ) : (
            <span className="pill pill-warn">Not Armed</span>
          )}
        </span>
        <span className="position-subsummary-values">
          <span className="trade-summary-value">
            <span className="trade-summary-label">Profile</span>
            <strong>{formatProfileLabel(position.trailing_profile)}</strong>
          </span>
          <span className="trade-summary-value">
            <span className="trade-summary-label">Peak Profit</span>
            <strong>{formatSignedPct(position.trailing_peak_profit_pct)}</strong>
          </span>
          <span className="trade-summary-value">
            <span className="trade-summary-label">Status</span>
            <strong>{statusLabel}</strong>
          </span>
        </span>
      </summary>
      <div className="position-table-wrap">
        <table className="position-info-table position-info-table-compact">
          <tbody>
            <tr>
              <th scope="row">Status</th>
              <td>{statusLabel}</td>
            </tr>
            <tr>
              <th scope="row">Profile</th>
              <td>{formatProfileLabel(position.trailing_profile)}</td>
            </tr>
            <tr>
              <th scope="row">Current Profit</th>
              <td>{formatSignedPct(position.trailing_current_profit_pct)}</td>
            </tr>
            <tr>
              <th scope="row">Peak Profit</th>
              <td>{formatSignedPct(position.trailing_peak_profit_pct)}</td>
            </tr>
            <tr>
              <th scope="row">Giveback</th>
              <td>
                {position.trailing_giveback_pct !== null
                  ? formatPct(position.trailing_giveback_pct)
                  : 'n/a'}
              </td>
            </tr>
            <tr>
              <th scope="row">Allowed Giveback</th>
              <td>
                {position.trailing_allowed_giveback_pct !== null
                  ? formatPct(position.trailing_allowed_giveback_pct)
                  : 'n/a'}
              </td>
            </tr>
            <tr>
              <th scope="row">Take-Profit Rate Now</th>
              <td>{formatRate(trailingTakeProfitRate)}</td>
            </tr>
            <tr>
              <th scope="row">Activation Threshold</th>
              <td>{formatPct(position.trailing_activation_profit_pct)}</td>
            </tr>
            <tr>
              <th scope="row">Giveback Ratio</th>
              <td>{formatRatio(position.trailing_giveback_ratio)}</td>
            </tr>
            <tr>
              <th scope="row">Giveback Min</th>
              <td>{formatPct(position.trailing_giveback_min_pct)}</td>
            </tr>
            <tr>
              <th scope="row">Giveback Max</th>
              <td>{formatPct(position.trailing_giveback_max_pct)}</td>
            </tr>
            <tr>
              <th scope="row">Min Locked Profit</th>
              <td>{formatPct(position.trailing_min_locked_profit_pct)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ExchangeProtectionDetails({
  position,
}: {
  position: PositionPageItem;
}) {
  return (
    <details className="position-subcard">
      <summary className="position-subsummary">
        <span className="position-subhead">
          <h4>Exchange Protection</h4>
          {position.stop_loss_price !== null ? (
            <span className="pill">Stop Loss Active</span>
          ) : (
            <span className="pill pill-warn">Stop Loss Missing</span>
          )}
        </span>
        <span className="position-subsummary-values">
          <span className="trade-summary-value">
            <span className="trade-summary-label">Source</span>
            <strong>Exchange Sync</strong>
          </span>
          <span className="trade-summary-value">
            <span className="trade-summary-label">Stop Loss</span>
            <strong>{formatRate(position.stop_loss_price)}</strong>
          </span>
          <span className="trade-summary-value">
            <span className="trade-summary-label">Last Sync</span>
            <strong>
              {position.last_synced_at
                ? formatDateTime(position.last_synced_at)
                : 'n/a'}
            </strong>
          </span>
        </span>
      </summary>
      <div className="position-table-wrap">
        <table className="position-info-table position-info-table-compact">
          <tbody>
            <tr>
              <th scope="row">Position Source</th>
              <td>Imported from exchange</td>
            </tr>
            <tr>
              <th scope="row">Stop Loss</th>
              <td>{formatRate(position.stop_loss_price)}</td>
            </tr>
            <tr>
              <th scope="row">Last Synced</th>
              <td>
                {position.last_synced_at
                  ? formatDateTime(position.last_synced_at)
                  : 'n/a'}
              </td>
            </tr>
            <tr>
              <th scope="row">Linked App Position</th>
              <td>{position.linked_position_id ? 'Matched' : 'Not linked'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default async function PositionsPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    positions: PositionPageItem[];
  }>('/positions', {
    positions: [],
  });

  return (
    <section className="card">
      <h2>Open Positions</h2>
      {unavailable ? (
        <p className="status-line">
          Position data is temporarily unavailable while the backend API
          reconnects.
        </p>
      ) : null}
      {data.positions.length === 0 ? (
        <p className="muted">No open position data is available right now.</p>
      ) : (
        <div className="position-list">
          {data.positions.map((position) => (
            <article className="position-card" key={position.id}>
              <div className="signal-summary">
                <div className="signal-head">
                  <div>
                    <p className="eyebrow">Open Position</p>
                    <div className="position-title-row">
                      <h3 className="signal-symbol">{position.symbol}</h3>
                      <ExchangeBadge compact exchange={position.broker} />
                    </div>
                  </div>
                    <div className="position-pill-row">
                    {position.position_source === 'exchange' ? (
                      <span className="pill">Exchange Sync</span>
                    ) : null}
                    {position.is_counter_position ? (
                      <span className="pill pill-warn">Counter</span>
                    ) : null}
                    <span className={getSideClassName(position.side)}>
                      {position.side}
                    </span>
                  </div>
                </div>
                <PositionOverviewTable position={position} />
              </div>
              {position.supports_trailing ? (
                <TrailingDetails position={position} />
              ) : (
                <ExchangeProtectionDetails position={position} />
              )}
              <Suspense fallback={<PositionChartFallback />}>
                <PositionChart
                  entryPrice={position.entry_price}
                  positionId={position.id}
                  symbol={position.symbol}
                />
              </Suspense>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
