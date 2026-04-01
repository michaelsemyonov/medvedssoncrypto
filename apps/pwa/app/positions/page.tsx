import { fetchApiWithFallback } from '@/lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function PositionsPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    positions: Array<Record<string, unknown>>;
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
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Entry Time</th>
            <th>Entry Price</th>
            <th>Qty</th>
            <th>Unrealized PnL</th>
          </tr>
        </thead>
        <tbody>
          {data.positions.length === 0 ? (
            <tr className="table-empty-row">
              <td colSpan={6} className="muted">
                No open position data is available right now.
              </td>
            </tr>
          ) : null}
          {data.positions.map((position) => (
            <tr key={String(position.id)}>
              <td data-label="Symbol">{String(position.symbol)}</td>
              <td data-label="Side">{String(position.side)}</td>
              <td data-label="Entry Time">
                {new Date(String(position.entry_time)).toLocaleString()}
              </td>
              <td data-label="Entry Price">
                {Number(position.entry_price).toFixed(4)}
              </td>
              <td data-label="Qty">{Number(position.qty).toFixed(6)}</td>
              <td data-label="Unrealized PnL">
                {Number(position.unrealized_pnl ?? 0).toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
