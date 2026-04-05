import { Suspense } from 'react';
import { Alert, Card, Collapse, Descriptions, Empty, Space } from 'antd';

import { CandleChart } from '@/components/candle-chart.tsx';
import { ExchangeBadge } from '@/components/exchange-badge.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';
import { Eyebrow, StatusTag } from '@/components/ui-primitives.tsx';

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
    <Descriptions
      className="signal-descriptions"
      column={{ lg: 3, md: 2, sm: 1, xs: 1 }}
      items={[
        {
          key: 'entryTime',
          label: 'Entry Time',
          children: formatDateTime(position.entry_time),
        },
        {
          key: 'entryPrice',
          label: 'Entry Price',
          children: position.entry_price.toFixed(4),
        },
        {
          key: 'qty',
          label: 'Qty',
          children: position.qty.toFixed(6),
        },
        {
          key: 'amount',
          label: 'Amount',
          children: formatUsdtValue(position.notional_usdt),
        },
        {
          key: 'unrealized',
          label: 'Unrealized PnL',
          children: formatSignedValue(position.unrealized_pnl),
        },
        {
          key: 'type',
          label: 'Position Type',
          children: position.is_counter_position ? 'Counter' : 'Primary',
        },
        {
          key: 'exchange',
          label: 'Exchange',
          children: <ExchangeBadge exchange={position.broker} />,
        },
      ]}
    />
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
    <Collapse
      className="detail-collapse"
      items={[
        {
          key: 'trailing-profit',
          label: (
            <div className="position-subsummary">
              <div className="position-subhead">
                <h4>Trailing Profit</h4>
                <StatusTag
                  tone={
                    !position.trailing_enabled || !armed ? 'warning' : 'success'
                  }
                >
                  {!position.trailing_enabled
                    ? 'Disabled'
                    : armed
                      ? 'Armed'
                      : 'Not Armed'}
                </StatusTag>
              </div>
              <Space className="position-subsummary-values" size={16} wrap>
                <span className="trade-summary-value">
                  <span className="trade-summary-label">Profile</span>
                  <strong>
                    {formatProfileLabel(position.trailing_profile)}
                  </strong>
                </span>
                <span className="trade-summary-value">
                  <span className="trade-summary-label">Peak Profit</span>
                  <strong>
                    {formatSignedPct(position.trailing_peak_profit_pct)}
                  </strong>
                </span>
                <span className="trade-summary-value">
                  <span className="trade-summary-label">Status</span>
                  <strong>{statusLabel}</strong>
                </span>
              </Space>
            </div>
          ),
          children: (
            <Descriptions
              bordered
              className="compact-descriptions"
              column={1}
              items={[
                { key: 'status', label: 'Status', children: statusLabel },
                {
                  key: 'profile',
                  label: 'Profile',
                  children: formatProfileLabel(position.trailing_profile),
                },
                {
                  key: 'current',
                  label: 'Current Profit',
                  children: formatSignedPct(
                    position.trailing_current_profit_pct
                  ),
                },
                {
                  key: 'peak',
                  label: 'Peak Profit',
                  children: formatSignedPct(position.trailing_peak_profit_pct),
                },
                {
                  key: 'giveback',
                  label: 'Giveback',
                  children:
                    position.trailing_giveback_pct !== null
                      ? formatPct(position.trailing_giveback_pct)
                      : 'n/a',
                },
                {
                  key: 'allowed',
                  label: 'Allowed Giveback',
                  children:
                    position.trailing_allowed_giveback_pct !== null
                      ? formatPct(position.trailing_allowed_giveback_pct)
                      : 'n/a',
                },
                {
                  key: 'takeProfit',
                  label: 'Take-Profit Rate Now',
                  children: formatRate(trailingTakeProfitRate),
                },
                {
                  key: 'activation',
                  label: 'Activation Threshold',
                  children: formatPct(position.trailing_activation_profit_pct),
                },
                {
                  key: 'ratio',
                  label: 'Giveback Ratio',
                  children: formatRatio(position.trailing_giveback_ratio),
                },
                {
                  key: 'min',
                  label: 'Giveback Min',
                  children: formatPct(position.trailing_giveback_min_pct),
                },
                {
                  key: 'max',
                  label: 'Giveback Max',
                  children: formatPct(position.trailing_giveback_max_pct),
                },
                {
                  key: 'locked',
                  label: 'Min Locked Profit',
                  children: formatPct(position.trailing_min_locked_profit_pct),
                },
              ]}
            />
          ),
        },
      ]}
    />
  );
}

function ExchangeProtectionDetails({
  position,
}: {
  position: PositionPageItem;
}) {
  return (
    <Collapse
      className="detail-collapse"
      items={[
        {
          key: 'exchange-protection',
          label: (
            <div className="position-subsummary">
              <div className="position-subhead">
                <h4>Exchange Protection</h4>
                <StatusTag
                  tone={
                    position.stop_loss_price !== null ? 'success' : 'warning'
                  }
                >
                  {position.stop_loss_price !== null
                    ? 'Stop Loss Active'
                    : 'Stop Loss Missing'}
                </StatusTag>
              </div>
              <Space className="position-subsummary-values" size={16} wrap>
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
              </Space>
            </div>
          ),
          children: (
            <Descriptions
              bordered
              className="compact-descriptions"
              column={1}
              items={[
                {
                  key: 'source',
                  label: 'Position Source',
                  children: 'Imported from exchange',
                },
                {
                  key: 'stopLoss',
                  label: 'Stop Loss',
                  children: formatRate(position.stop_loss_price),
                },
                {
                  key: 'lastSynced',
                  label: 'Last Synced',
                  children: position.last_synced_at
                    ? formatDateTime(position.last_synced_at)
                    : 'n/a',
                },
                {
                  key: 'linked',
                  label: 'Linked App Position',
                  children: position.linked_position_id
                    ? 'Matched'
                    : 'Not linked',
                },
              ]}
            />
          ),
        },
      ]}
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
    <Card className="surface-card" styles={{ body: { padding: 20 } }}>
      <h2>Open Positions</h2>
      {unavailable ? (
        <Alert
          description="Position data is temporarily unavailable while the backend API reconnects."
          showIcon
          type="warning"
        />
      ) : null}
      {data.positions.length === 0 ? (
        <Empty
          description="No open position data is available right now."
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="position-list">
          {data.positions.map((position) => (
            <Card
              className="surface-card"
              key={position.id}
              styles={{ body: { padding: 18 } }}
            >
              <div className="position-card">
                <div className="signal-summary">
                  <div className="signal-head">
                    <div>
                      <Eyebrow>Open Position</Eyebrow>
                      <div className="position-title-row">
                        <h3 className="signal-symbol">{position.symbol}</h3>
                        <ExchangeBadge compact exchange={position.broker} />
                      </div>
                    </div>
                    <div className="position-pill-row">
                      {position.position_source === 'exchange' ? (
                        <StatusTag tone="success">Exchange Sync</StatusTag>
                      ) : null}
                      {position.is_counter_position ? (
                        <StatusTag tone="warning">Counter</StatusTag>
                      ) : null}
                      <StatusTag
                        tone={position.side === 'LONG' ? 'success' : 'warning'}
                      >
                        {position.side}
                      </StatusTag>
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}
