import { fetchApi } from '../../lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function PositionsPage() {
  const data = await fetchApi<{ positions: Array<Record<string, unknown>> }>('/positions');

  return (
    <section className="card">
      <h2>Open Positions</h2>
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
          {data.positions.map((position) => (
            <tr key={String(position.id)}>
              <td>{String(position.symbol)}</td>
              <td>{String(position.side)}</td>
              <td>{new Date(String(position.entry_time)).toLocaleString()}</td>
              <td>{Number(position.entry_price).toFixed(4)}</td>
              <td>{Number(position.qty).toFixed(6)}</td>
              <td>{Number(position.unrealized_pnl ?? 0).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
