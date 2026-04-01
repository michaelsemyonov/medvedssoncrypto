import { formatTime } from '@/lib/datetime.ts';

type CandlePoint = {
  close: number;
  closeTime: string;
  high: number;
  low: number;
  open: number;
};

type CandleChartProps = {
  ariaLabel: string;
  candles: CandlePoint[];
  emptyMessage: string;
  footerLabel: string;
  highlightLastCandle?: boolean;
  referencePrice?: number;
  summary: string;
  title: string;
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 140;
const CHART_PADDING = {
  top: 12,
  right: 56,
  bottom: 24,
  left: 10,
};
const Y_AXIS_TICK_COUNT: number = 3;

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

export function CandleChart({
  ariaLabel,
  candles,
  emptyMessage,
  footerLabel,
  highlightLastCandle = false,
  referencePrice,
  summary,
  title,
}: CandleChartProps) {
  if (candles.length === 0) {
    return (
      <div className="signal-chart signal-chart-empty">
        <p className="muted">{emptyMessage}</p>
      </div>
    );
  }

  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const baselinePrice = referencePrice ?? candles.at(-1)!.close;
  const minPrice = Math.min(...lows, baselinePrice);
  const maxPrice = Math.max(...highs, baselinePrice);
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
  const plotRightX = CHART_WIDTH - CHART_PADDING.right;
  const axisLabelX = plotRightX + 6;
  const yAxisTicks = Array.from({ length: Y_AXIS_TICK_COUNT }, (_, index) => {
    const ratio =
      Y_AXIS_TICK_COUNT === 1 ? 0 : index / (Y_AXIS_TICK_COUNT - 1);
    const value = maxPrice - priceRange * ratio;

    return {
      value,
      y: yForPrice(value),
    };
  });
  const baselineY = yForPrice(baselinePrice);
  const baselineLabelY = Math.min(
    Math.max(baselineY - 4, CHART_PADDING.top + 10),
    CHART_PADDING.top + innerHeight - 2
  );

  return (
    <div className="signal-chart">
      <div className="signal-chart-head">
        <span>{title}</span>
        <span>{summary}</span>
      </div>
      <svg
        aria-label={ariaLabel}
        className="signal-chart-svg"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        {highlightLastCandle ? (
          <rect
            className="signal-chart-trigger"
            height={innerHeight + 8}
            rx="8"
            width={slotWidth}
            x={CHART_PADDING.left + slotWidth * (candles.length - 1)}
            y={CHART_PADDING.top - 4}
          />
        ) : null}
        {yAxisTicks.map((tick, index) => (
          <g key={`${tick.value}-${index}`}>
            <line
              className="signal-chart-gridline"
              x1={CHART_PADDING.left}
              x2={plotRightX}
              y1={tick.y}
              y2={tick.y}
            />
            <text
              className="signal-chart-axis-label"
              x={axisLabelX}
              y={tick.y + 4}
            >
              {formatPrice(tick.value)}
            </text>
          </g>
        ))}
        <line
          className="signal-chart-baseline"
          x1={CHART_PADDING.left}
          x2={plotRightX}
          y1={baselineY}
          y2={baselineY}
        />
        <text
          className="signal-chart-reference-label"
          x={axisLabelX}
          y={baselineLabelY}
        >
          {referencePrice === undefined
            ? formatPrice(baselinePrice)
            : `Entry ${formatPrice(baselinePrice)}`}
        </text>
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
          x={plotRightX}
          y={CHART_HEIGHT - 6}
        >
          {lastLabel}
        </text>
      </svg>
      <div className="signal-chart-foot">
        <span>{footerLabel}</span>
        <span>
          {formatPrice(minPrice)} - {formatPrice(maxPrice)}
        </span>
      </div>
    </div>
  );
}
