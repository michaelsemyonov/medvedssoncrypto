import { fetchApiWithFallback } from '@/lib/api.ts';

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

export default async function TradesPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    trades: Array<Record<string, unknown>>;
  }>('/trades?limit=100', {
    trades: [],
  });
  const trades = [...data.trades].sort((left, right) => {
    const leftExitTime = toTimestamp(left.exit_time);
    const rightExitTime = toTimestamp(right.exit_time);
    return rightExitTime - leftExitTime;
  });

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
              <td colSpan={7} className="muted">
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
