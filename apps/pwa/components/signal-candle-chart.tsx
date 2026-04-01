import { formatTime } from '@/lib/datetime.ts';

type CandlePoint = {
  close: number;
  closeTime: string;
  high: number;
  low: number;
  open: number;
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 140;
const CHART_PADDING = {
  top: 12,
  right: 10,
  bottom: 24,
  left: 10,
};

const formatPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(2);
  }

  if (Math.abs(value) >= 1) {
    return value.toFixed(3);
  }

  return value.toFixed(5);
};

export function SignalCandleChart({ candles }: { candles: CandlePoint[] }) {
  if (candles.length === 0) {
    return (
      <div className="signal-chart signal-chart-empty">
        <p className="muted">
          No stored candles are available for this signal yet.
        </p>
      </div>
    );
  }

  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const priceRange = Math.max(maxPrice - minPrice, maxPrice * 0.01, 1e-9);
  const innerWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const slotWidth = innerWidth / candles.length;
  const bodyWidth = Math.max(4, slotWidth * 0.56);

  const yForPrice = (price: number): number =>
    CHART_PADDING.top + ((maxPrice - price) / priceRange) * innerHeight;

  const lastCandle = candles.at(-1)!;
  const firstLabel = formatTime(candles[0]!.closeTime);
  const lastLabel = formatTime(lastCandle.closeTime);

  return (
    <div className="signal-chart">
      <div className="signal-chart-head">
        <span>Latest 60 min</span>
        <span>{candles.length}/12 candles</span>
      </div>
      <svg
        aria-label="Candlestick chart for the latest 60 minutes before the signal"
        className="signal-chart-svg"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <rect
          className="signal-chart-trigger"
          height={innerHeight + 8}
          rx="8"
          width={slotWidth}
          x={CHART_PADDING.left + slotWidth * (candles.length - 1)}
          y={CHART_PADDING.top - 4}
        />
        <line
          className="signal-chart-baseline"
          x1={CHART_PADDING.left}
          x2={CHART_WIDTH - CHART_PADDING.right}
          y1={yForPrice(lastCandle.close)}
          y2={yForPrice(lastCandle.close)}
        />
        {candles.map((candle, index) => {
          const centerX =
            CHART_PADDING.left + slotWidth * index + slotWidth / 2;
          const openY = yForPrice(candle.open);
          const closeY = yForPrice(candle.close);
          const highY = yForPrice(candle.high);
          const lowY = yForPrice(candle.low);
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(openY - closeY), 2);
          const rising = candle.close >= candle.open;

          return (
            <g
              key={`${candle.closeTime}-${index}`}
              className={
                rising
                  ? 'signal-candle signal-candle-up'
                  : 'signal-candle signal-candle-down'
              }
            >
              <line x1={centerX} x2={centerX} y1={highY} y2={lowY} />
              <rect
                height={bodyHeight}
                rx="2"
                width={bodyWidth}
                x={centerX - bodyWidth / 2}
                y={bodyY}
              />
            </g>
          );
        })}
        <text
          className="signal-chart-label"
          x={CHART_PADDING.left}
          y={CHART_HEIGHT - 6}
        >
          {firstLabel}
        </text>
        <text
          className="signal-chart-label signal-chart-label-end"
          x={CHART_WIDTH - CHART_PADDING.right}
          y={CHART_HEIGHT - 6}
        >
          {lastLabel}
        </text>
      </svg>
      <div className="signal-chart-foot">
        <span>Signal candle highlighted</span>
        <span>
          {formatPrice(minPrice)} - {formatPrice(maxPrice)}
        </span>
      </div>
    </div>
  );
}
