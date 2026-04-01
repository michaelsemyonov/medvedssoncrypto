import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';

export const dynamic = 'force-dynamic';

type TradeRecord = Record<string, unknown>;

function getTradeOpenedValue(trade: TradeRecord): unknown {
  return (
    trade.opening_order_filled_at ?? trade.opened_at ?? trade.entry_time
  );
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

function compareTradesDesc(
  left: TradeRecord,
  right: TradeRecord
): number {
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

function formatSignedNumber(
  value: unknown,
  digits = 4,
  suffix = ''
): string {
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

function renderTradeDetailItems(trade: TradeRecord) {
  const detailItems = [
    ['Position ID', String(trade.id ?? 'n/a')],
    ['Status', String(trade.status ?? 'n/a')],
    ['Symbol', String(trade.symbol ?? 'n/a')],
    ['Side', String(trade.side ?? 'n/a')],
    [
      'Counter Position',
      trade.is_counter_position ? 'Yes' : 'No',
    ],
    ['Broker', String(trade.broker ?? 'n/a')],
    ['Opened', formatDateTime(getTradeOpenedValue(trade))],
    ['Entry Time', formatDateTime(trade.entry_time)],
    ['Exit Time', formatDateTime(trade.exit_time)],
    [
      'Duration',
      formatTradeDuration(
        trade.entry_time ?? trade.opening_order_filled_at,
        trade.exit_time
      ),
    ],
    ['Entry Price', formatNumber(trade.entry_price)],
    ['Exit Price', formatNumber(trade.exit_price)],
    ['Quantity', formatNumber(trade.qty, 6)],
    ['Notional', formatNumber(trade.notional_usdt, 2, ' USDT')],
    ['Entry Fee', formatNumber(trade.entry_fee)],
    ['Exit Fee', formatNumber(trade.exit_fee)],
    [
      'Total Fees',
      formatNumber(
        Number(trade.entry_fee ?? 0) + Number(trade.exit_fee ?? 0)
      ),
    ],
    ['Realized PnL', formatSignedNumber(trade.realized_pnl)],
    ['Opened By Signal', String(trade.opened_by_signal_id ?? 'n/a')],
    ['Closed By Signal', String(trade.closed_by_signal_id ?? 'n/a')],
    [
      'Opening Order Created',
      formatDateTime(trade.opening_order_created_at),
    ],
    [
      'Opening Order Filled',
      formatDateTime(trade.opening_order_filled_at),
    ],
    ['Created At', formatDateTime(trade.created_at)],
    ['Updated At', formatDateTime(trade.updated_at)],
  ] satisfies Array<[string, string]>;

  return detailItems;
}

export default async function TradesPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    trades: TradeRecord[];
  }>('/trades?limit=100', {
    trades: [],
  });
  const trades = [...data.trades].sort(compareTradesDesc);

  return (
    <section className="card">
      <h2>Simulated Trades</h2>
      {unavailable ? (
        <p className="status-line">
          Trade history is temporarily unavailable while the backend API
          reconnects.
        </p>
      ) : null}
      {trades.length === 0 ? (
        <p className="muted">No trade data is available right now.</p>
      ) : (
        <div className="trade-list" role="list">
          {trades.map((trade) => {
            const details = renderTradeDetailItems(trade);

            return (
              <details className="trade-row" key={String(trade.id)} role="listitem">
                <summary className="trade-summary">
                  <span className="trade-summary-main">
                    <span className="trade-summary-symbol">
                      {String(trade.symbol)}
                    </span>
                    <span className="pill trade-summary-side">
                      {String(trade.side)}
                    </span>
                    {trade.is_counter_position ? (
                      <span className="pill pill-warn">Counter</span>
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
                        Number(trade.entry_fee ?? 0) +
                          Number(trade.exit_fee ?? 0)
                      )}
                    </strong>
                  </span>
                  <span className={getTradeHeadlineClassName(trade)}>
                    <span className="trade-summary-label">PnL</span>
                    <strong>{formatSignedNumber(trade.realized_pnl)}</strong>
                  </span>
                </summary>
                <div className="trade-detail-grid">
                  {details.map(([label, value]) => (
                    <div className="trade-detail-item" key={`${trade.id}-${label}`}>
                      <span className="trade-detail-label">{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
