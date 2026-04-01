import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { data: dashboard, unavailable } = await fetchApiWithFallback<{
    activeSymbols: Array<{ symbol: string }>;
    latestSignals: Array<{
      symbol: string;
      signal_type: string;
      candle_close_time: string;
      approved: boolean | null;
    }>;
    openPositionsCount: number;
    stats: {
      closedTrades: number;
      winRate: number;
      averageTradeReturn: number;
      totalRealizedPnl: number;
      equity: number;
      maxDrawdownPct: number;
    };
    runner: {
      running: boolean;
      lastTickCompletedAt: string | null;
      lastError: string | null;
    };
  }>('/dashboard', {
    activeSymbols: [],
    latestSignals: [],
    openPositionsCount: 0,
    stats: {
      closedTrades: 0,
      winRate: 0,
      averageTradeReturn: 0,
      totalRealizedPnl: 0,
      equity: 0,
      maxDrawdownPct: 0,
    },
    runner: {
      running: false,
      lastTickCompletedAt: null,
      lastError: 'The backend API is temporarily unavailable.',
    },
  });

  return (
    <div className="stack-lg">
      {unavailable ? (
        <section className="card">
          <div className="eyebrow">Temporary Degradation</div>
          <p className="status-line">
            Dashboard data is temporarily unavailable while the backend API
            reconnects.
          </p>
        </section>
      ) : null}

      <section className="grid">
        <article className="card">
          <div className="eyebrow">Tracked Symbols</div>
          <div className="metric">{dashboard.activeSymbols.length}</div>
          <p className="muted">
            {dashboard.activeSymbols
              .map((symbol) => symbol.symbol)
              .join(', ') || 'No symbols configured'}
          </p>
        </article>
        <article className="card">
          <div className="eyebrow">Open Dry-Run Positions</div>
          <div className="metric">{dashboard.openPositionsCount}</div>
          <p className="muted">
            Single position per symbol, next-open fill model.
          </p>
        </article>
        <article className="card">
          <div className="eyebrow">Win Rate</div>
          <div className="metric">
            {Number(dashboard.stats.winRate ?? 0).toFixed(1)}%
          </div>
          <p className="muted">
            {dashboard.stats.closedTrades} closed simulated trades.
          </p>
        </article>
        <article className="card">
          <div className="eyebrow">Runner Health</div>
          <div className="metric">
            {dashboard.runner.running ? 'Live' : 'Stopped'}
          </div>
          <p className="muted">
            {dashboard.runner.lastError
              ? dashboard.runner.lastError
              : `Last tick ${
                  dashboard.runner.lastTickCompletedAt
                    ? formatDateTime(dashboard.runner.lastTickCompletedAt)
                    : 'not yet completed'
                }`}
          </p>
        </article>
      </section>

      <section className="card">
        <h2>Latest Signal Per Symbol</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Signal</th>
              <th>Time</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.latestSignals.length === 0 ? (
              <tr className="table-empty-row">
                <td colSpan={4} className="muted">
                  No signal data is available right now.
                </td>
              </tr>
            ) : null}
            {dashboard.latestSignals.map((item) => (
              <tr key={item.symbol}>
                <td data-label="Symbol">{item.symbol}</td>
                <td data-label="Signal">{item.signal_type}</td>
                <td data-label="Time">{formatDateTime(item.candle_close_time)}</td>
                <td data-label="Approval">
                  <span className={item.approved ? 'pill' : 'pill pill-warn'}>
                    {item.approved === null
                      ? 'Pending'
                      : item.approved
                        ? 'Approved'
                        : 'Rejected'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
