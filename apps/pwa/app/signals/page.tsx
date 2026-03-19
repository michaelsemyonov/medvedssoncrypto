import { fetchApi } from '../../lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function SignalsPage() {
  const data = await fetchApi<{ signals: Array<Record<string, unknown>> }>('/signals?limit=100');

  return (
    <section className="card">
      <h2>Recent Signals</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Type</th>
            <th>Time</th>
            <th>Approved</th>
            <th>Reason</th>
            <th>Formula</th>
          </tr>
        </thead>
        <tbody>
          {data.signals.map((signal) => {
            const formula = signal.formula_inputs as Record<string, number | null>;

            return (
              <tr key={String(signal.id)}>
                <td>{String(signal.symbol)}</td>
                <td>{String(signal.signal_type)}</td>
                <td>{new Date(String(signal.candle_close_time)).toLocaleString()}</td>
                <td>
                  <span className={signal.approved ? 'pill' : 'pill pill-warn'}>
                    {signal.approved === null ? 'Pending' : signal.approved ? 'Approved' : 'Rejected'}
                  </span>
                </td>
                <td>{String(signal.rejection_reason ?? signal.reason)}</td>
                <td>
                  r_t={formula.r_t?.toFixed?.(6) ?? 'n/a'} / B_t={formula.B_t?.toFixed?.(6) ?? 'n/a'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
