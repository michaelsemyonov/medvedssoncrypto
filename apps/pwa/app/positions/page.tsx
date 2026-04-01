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
};

const formatSignedValue = (value: number | null): string =>
  value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(4)}`;

const formatUsdtValue = (value: number): string => `${value.toFixed(2)} USDT`;

const getSideClassName = (side: PositionPageItem['side']): string =>
  side === 'LONG' ? 'pill' : 'pill pill-warn';

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
                    <strong>{formatSignedValue(position.unrealized_pnl)}</strong>
                  </div>
                </div>
              </div>
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
