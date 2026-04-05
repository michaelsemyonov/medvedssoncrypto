import type { ReactNode } from 'react';
import { Alert, Card, Collapse, Descriptions, Empty, Space } from 'antd';

import { ExchangeBadge } from '@/components/exchange-badge.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';
import { StatusTag } from '@/components/ui-primitives.tsx';

export const dynamic = 'force-dynamic';

type TradeRecord = Record<string, unknown>;
type TradeGroup = {
  trade: TradeRecord;
  counterTrades: TradeRecord[];
};

function getTradeOpenedValue(trade: TradeRecord): unknown {
  return trade.opening_order_filled_at ?? trade.opened_at ?? trade.entry_time;
}

function toTimestamp(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  return 0;
}

function compareTradesDesc(left: TradeRecord, right: TradeRecord): number {
  const entryTimeDiff =
    toTimestamp(getTradeOpenedValue(right)) -
    toTimestamp(getTradeOpenedValue(left));

  if (entryTimeDiff !== 0) {
    return entryTimeDiff;
  }

  const updatedAtDiff =
    toTimestamp(right.updated_at) - toTimestamp(left.updated_at);

  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  return toTimestamp(right.created_at) - toTimestamp(left.created_at);
}

function formatSignedNumber(value: unknown, digits = 4, suffix = ''): string {
  const number = Number(value ?? 0);

  if (!Number.isFinite(number)) {
    return 'n/a';
  }

  return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}${suffix}`;
}

function formatNumber(value: unknown, digits = 4, suffix = ''): string {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 'n/a';
  }

  return `${number.toFixed(digits)}${suffix}`;
}

function formatPrimitiveValue(value: unknown, fallback = 'n/a'): string {
  if (typeof value === 'string') {
    return value.length > 0 ? value : fallback;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  return fallback;
}

function formatTradeDuration(start: unknown, end: unknown): string {
  const startTimestamp = toTimestamp(start);
  const endTimestamp = toTimestamp(end);

  if (startTimestamp === 0 || endTimestamp === 0) {
    return 'n/a';
  }

  const diffMs = endTimestamp - startTimestamp;

  if (diffMs <= 0) {
    return '0h 0m';
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
}

function getTradeId(trade: TradeRecord): string {
  return formatPrimitiveValue(trade.id, 'trade');
}

function getTradeSymbol(trade: TradeRecord): string {
  return formatPrimitiveValue(trade.symbol);
}

function isCounterTrade(trade: TradeRecord): boolean {
  return Boolean(trade.is_counter_position);
}

function getTradeHeadlineClassName(trade: TradeRecord): string {
  const pnl = Number(trade.realized_pnl ?? 0);

  if (pnl > 0) {
    return 'trade-summary-value trade-summary-value-positive';
  }

  if (pnl < 0) {
    return 'trade-summary-value trade-summary-value-negative';
  }

  return 'trade-summary-value';
}

function getTradeSideClassName(
  trade: TradeRecord
): 'success' | 'warning' {
  return formatPrimitiveValue(trade.side) === 'SHORT' ? 'warning' : 'success';
}

function renderTradeDetailItems(
  trade: TradeRecord
): Array<{ label: string; value: ReactNode }> {
  const detailItems = [
    { label: 'Position ID', value: formatPrimitiveValue(trade.id) },
    { label: 'Status', value: formatPrimitiveValue(trade.status) },
    { label: 'Symbol', value: formatPrimitiveValue(trade.symbol) },
    { label: 'Side', value: formatPrimitiveValue(trade.side) },
    {
      label: 'Counter Position',
      value: Boolean(trade.is_counter_position) ? 'Yes' : 'No',
    },
    {
      label: 'Broker',
      value: (
        <ExchangeBadge exchange={formatPrimitiveValue(trade.broker, 'bybit')} />
      ),
    },
    { label: 'Opened', value: formatDateTime(getTradeOpenedValue(trade)) },
    { label: 'Entry Time', value: formatDateTime(trade.entry_time) },
    { label: 'Exit Time', value: formatDateTime(trade.exit_time) },
    {
      label: 'Duration',
      value: formatTradeDuration(
        trade.entry_time ?? trade.opening_order_filled_at,
        trade.exit_time
      ),
    },
    { label: 'Entry Price', value: formatNumber(trade.entry_price) },
    { label: 'Exit Price', value: formatNumber(trade.exit_price) },
    { label: 'Quantity', value: formatNumber(trade.qty, 6) },
    {
      label: 'Notional',
      value: formatNumber(trade.notional_usdt, 2, ' USDT'),
    },
    { label: 'Entry Fee', value: formatNumber(trade.entry_fee) },
    { label: 'Exit Fee', value: formatNumber(trade.exit_fee) },
    {
      label: 'Total Fees',
      value: formatNumber(
        Number(trade.entry_fee ?? 0) + Number(trade.exit_fee ?? 0)
      ),
    },
    { label: 'Realized PnL', value: formatSignedNumber(trade.realized_pnl) },
    {
      label: 'Opened By Signal',
      value: formatPrimitiveValue(trade.opened_by_signal_id),
    },
    {
      label: 'Closed By Signal',
      value: formatPrimitiveValue(trade.closed_by_signal_id),
    },
    {
      label: 'Opening Order Created',
      value: formatDateTime(trade.opening_order_created_at),
    },
    {
      label: 'Opening Order Filled',
      value: formatDateTime(trade.opening_order_filled_at),
    },
    { label: 'Created At', value: formatDateTime(trade.created_at) },
    { label: 'Updated At', value: formatDateTime(trade.updated_at) },
  ];

  return detailItems;
}

function findCounterTradeParent(
  counterTrade: TradeRecord,
  rootTrades: TradeRecord[]
): TradeRecord | null {
  const counterSymbol = getTradeSymbol(counterTrade);
  const counterStartedAt = toTimestamp(
    counterTrade.entry_time ??
      counterTrade.opening_order_filled_at ??
      getTradeOpenedValue(counterTrade)
  );

  let nearestParent: { trade: TradeRecord; delta: number } | null = null;

  for (const trade of rootTrades) {
    if (getTradeSymbol(trade) !== counterSymbol) {
      continue;
    }

    const exitTimestamp = toTimestamp(trade.exit_time);

    if (exitTimestamp === 0 || exitTimestamp > counterStartedAt) {
      continue;
    }

    const delta = counterStartedAt - exitTimestamp;

    if (delta === 0) {
      return trade;
    }

    if (nearestParent === null || delta < nearestParent.delta) {
      nearestParent = {
        trade,
        delta,
      };
    }
  }

  return nearestParent?.trade ?? null;
}

function buildTradeGroups(trades: TradeRecord[]): TradeGroup[] {
  const rootGroups: TradeGroup[] = trades
    .filter((trade) => !isCounterTrade(trade))
    .map((trade) => ({
      trade,
      counterTrades: [] as TradeRecord[],
    }));
  const rootGroupById = new Map(
    rootGroups.map((group) => [getTradeId(group.trade), group])
  );
  const unmatchedCounterGroups: TradeGroup[] = [];

  for (const trade of trades) {
    if (!isCounterTrade(trade)) {
      continue;
    }

    const parentTrade = findCounterTradeParent(
      trade,
      rootGroups.map((group) => group.trade)
    );

    if (!parentTrade) {
      unmatchedCounterGroups.push({
        trade,
        counterTrades: [],
      });
      continue;
    }

    rootGroupById.get(getTradeId(parentTrade))?.counterTrades.push(trade);
  }

  return [...rootGroups, ...unmatchedCounterGroups];
}

function TradeCard({
  trade,
  nested = false,
}: {
  trade: TradeRecord;
  nested?: boolean;
}) {
  const details = renderTradeDetailItems(trade);
  const tradeId = getTradeId(trade);

  return (
    <Collapse
      className={nested ? 'trade-row trade-row-nested' : 'trade-row'}
      items={[
        {
          key: tradeId,
          label: (
            <div className="trade-summary">
              <span className="trade-summary-main">
                <span className="trade-summary-symbol">
                  {formatPrimitiveValue(trade.symbol)}
                </span>
                <ExchangeBadge
                  compact
                  exchange={formatPrimitiveValue(trade.broker, 'bybit')}
                />
                <StatusTag tone={getTradeSideClassName(trade)}>
                  {formatPrimitiveValue(trade.side)}
                </StatusTag>
                {Boolean(trade.is_counter_position) ? (
                  <StatusTag tone="warning">Counter</StatusTag>
                ) : null}
              </span>
              <span className="trade-summary-value">
                <span className="trade-summary-label">Opened</span>
                <strong>{formatDateTime(getTradeOpenedValue(trade))}</strong>
              </span>
              <span className="trade-summary-value">
                <span className="trade-summary-label">Entry</span>
                <strong>{formatNumber(trade.entry_price)}</strong>
              </span>
              <span className="trade-summary-value">
                <span className="trade-summary-label">Exit</span>
                <strong>{formatNumber(trade.exit_price)}</strong>
              </span>
              <span className="trade-summary-value">
                <span className="trade-summary-label">Fees</span>
                <strong>
                  {formatNumber(
                    Number(trade.entry_fee ?? 0) + Number(trade.exit_fee ?? 0)
                  )}
                </strong>
              </span>
              <span className={getTradeHeadlineClassName(trade)}>
                <span className="trade-summary-label">PnL</span>
                <strong>{formatSignedNumber(trade.realized_pnl)}</strong>
              </span>
            </div>
          ),
          children: (
            <Descriptions
              bordered
              className="compact-descriptions"
              column={{ lg: 2, md: 2, sm: 1, xs: 1 }}
              items={details.map((item) => ({
                key: `${tradeId}-${item.label}`,
                label: item.label,
                children: item.value,
              }))}
            />
          ),
        },
      ]}
    />
  );
}

export default async function TradesPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    trades: TradeRecord[];
  }>('/trades?limit=100', {
    trades: [],
  });
  const trades = [...data.trades].sort(compareTradesDesc);
  const tradeGroups = buildTradeGroups(trades);

  return (
    <Card className="surface-card" styles={{ body: { padding: 20 } }}>
      <h2>Simulated Trades</h2>
      {unavailable ? (
        <Alert
          description="Trade history is temporarily unavailable while the backend API reconnects."
          showIcon
          type="warning"
        />
      ) : null}
      {trades.length === 0 ? (
        <Empty
          description="No trade data is available right now."
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="trade-list">
          {tradeGroups.map((group) => (
            <div className="trade-stack" key={getTradeId(group.trade)}>
              <TradeCard trade={group.trade} />
              {group.counterTrades.length > 0 ? (
                <Space
                  className="trade-nested-list"
                  direction="vertical"
                  size={10}
                >
                  {group.counterTrades.map((counterTrade) => (
                    <TradeCard
                      key={getTradeId(counterTrade)}
                      nested
                      trade={counterTrade}
                    />
                  ))}
                </Space>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
