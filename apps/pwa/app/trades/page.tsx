import { fetchApiWithFallback } from '@/lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function TradesPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    trades: Array<Record<string, unknown>>;
  }>('/trades?limit=100', {
    trades: [],
  });
  const trades = [...data.trades].sort((left, right) => {
    const leftExitTime = new Date(String(left.exit_time ?? 0)).getTime();
    const rightExitTime = new Date(String(right.exit_time ?? 0)).getTime();
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
              new Date(String(trade.exit_time)).getTime() -
              new Date(String(trade.entry_time)).getTime();

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
