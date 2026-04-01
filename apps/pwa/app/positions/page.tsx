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
  qty: number;
  recent_candles: PositionPageCandle[];
  side: 'LONG' | 'SHORT';
  symbol: string;
  unrealized_pnl: number | null;
};

const formatSignedValue = (value: number | null): string =>
  value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(4)}`;

const getSideClassName = (side: PositionPageItem['side']): string =>
  side === 'LONG' ? 'pill' : 'pill pill-warn';

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
                    <span className="signal-field-label">Unrealized PnL</span>
                    <strong>{formatSignedValue(position.unrealized_pnl)}</strong>
                  </div>
                </div>
              </div>
              <CandleChart
                ariaLabel={`Real-time candlestick chart for the latest 360 minutes on ${position.symbol}`}
                candles={position.recent_candles}
                emptyMessage="Real-time candles are temporarily unavailable for this position."
                footerLabel="Live exchange candles"
                summary={`${position.recent_candles.length}/24 candles`}
                title="Latest 360 min"
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
