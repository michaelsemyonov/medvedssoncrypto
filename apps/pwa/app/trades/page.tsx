import { fetchApi } from '../../lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function TradesPage() {
  const data = await fetchApi<{ trades: Array<Record<string, unknown>> }>('/trades?limit=100');

  return (
    <section className="card">
      <h2>Simulated Trades</h2>
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
          {data.trades.map((trade) => {
            const durationMs =
              new Date(String(trade.exit_time)).getTime() - new Date(String(trade.entry_time)).getTime();

            return (
              <tr key={String(trade.id)}>
                <td>{String(trade.symbol)}</td>
                <td>{String(trade.side)}</td>
                <td>{Number(trade.entry_price).toFixed(4)}</td>
                <td>{Number(trade.exit_price ?? 0).toFixed(4)}</td>
                <td>{Math.max(0, Math.round(durationMs / 60000))} min</td>
                <td>{(Number(trade.entry_fee ?? 0) + Number(trade.exit_fee ?? 0)).toFixed(4)}</td>
                <td>{Number(trade.realized_pnl ?? 0).toFixed(4)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
