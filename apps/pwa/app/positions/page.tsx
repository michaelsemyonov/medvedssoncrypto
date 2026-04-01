import { Suspense } from 'react';

import { CandleChart } from '@/components/candle-chart.tsx';
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
  entry_price: number;
  entry_time: string;
  id: string;
  notional_usdt: number;
  qty: number;
  side: 'LONG' | 'SHORT';
  symbol: string;
  unrealized_pnl: number | null;
  trailing_profile: string;
  trailing_enabled: boolean;
  trailing_activation_profit_pct: number;
  trailing_giveback_ratio: number;
  trailing_giveback_min_pct: number;
  trailing_giveback_max_pct: number;
  trailing_min_locked_profit_pct: number;
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

function TrailingDetails({ position }: { position: PositionPageItem }) {
  return (
    <details className="trade-row" style={{ marginTop: '8px' }}>
      <summary
        className="trade-summary"
        style={{ gridTemplateColumns: '1fr auto' }}
      >
        <span className="trade-summary-main">
          <span
            className="trade-summary-symbol"
            style={{ fontSize: '0.88rem' }}
          >
            Trailing Profit
          </span>
          <span
            className={position.trailing_enabled ? 'pill' : 'pill pill-warn'}
          >
            {position.trailing_enabled ? 'Enabled' : 'Disabled'}
          </span>
        </span>
        <span className="trade-summary-value">
          <span className="trade-summary-label">Profile</span>
          <strong>{formatProfileLabel(position.trailing_profile)}</strong>
        </span>
      </summary>
      <div className="trade-detail-wrap">
        <table className="data-table trade-detail-table">
          <tbody>
            <tr>
              <th scope="row">Profile</th>
              <td>{formatProfileLabel(position.trailing_profile)}</td>
            </tr>
            <tr>
              <th scope="row">Enabled</th>
              <td>{position.trailing_enabled ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th scope="row">Activation Profit</th>
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
                    <h3 className="signal-symbol">{position.symbol}</h3>
                  </div>
                  <span className={getSideClassName(position.side)}>
                    {position.side}
                  </span>
                </div>
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
                    <strong>
                      {formatSignedValue(position.unrealized_pnl)}
                    </strong>
                  </div>
                </div>
              </div>
              <TrailingDetails position={position} />
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
