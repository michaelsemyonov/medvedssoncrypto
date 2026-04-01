import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';

export const dynamic = 'force-dynamic';

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
  left: Record<string, unknown>,
  right: Record<string, unknown>
): number {
  const entryTimeDiff =
    toTimestamp(right.entry_time) - toTimestamp(left.entry_time);

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

export default async function TradesPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    trades: Array<Record<string, unknown>>;
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
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Opened</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Duration</th>
            <th>Fees</th>
            <th>PnL</th>
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <tr className="table-empty-row">
              <td colSpan={8} className="muted">
                No trade data is available right now.
              </td>
            </tr>
          ) : null}
          {trades.map((trade) => {
            const durationMs =
              toTimestamp(trade.exit_time) - toTimestamp(trade.entry_time);

            return (
              <tr key={String(trade.id)}>
                <td data-label="Symbol">{String(trade.symbol)}</td>
                <td data-label="Side">{String(trade.side)}</td>
                <td data-label="Opened">{formatDateTime(trade.entry_time)}</td>
                <td data-label="Entry">
                  {Number(trade.entry_price).toFixed(4)}
                </td>
                <td data-label="Exit">
                  {Number(trade.exit_price ?? 0).toFixed(4)}
                </td>
                <td data-label="Duration">
                  {Math.max(0, Math.round(durationMs / 60000))} min
                </td>
                <td data-label="Fees">
                  {(
                    Number(trade.entry_fee ?? 0) + Number(trade.exit_fee ?? 0)
                  ).toFixed(4)}
                </td>
                <td data-label="PnL">
                  {Number(trade.realized_pnl ?? 0).toFixed(4)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
