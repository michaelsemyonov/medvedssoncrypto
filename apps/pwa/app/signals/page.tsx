import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';

export const dynamic = 'force-dynamic';

export default async function SignalsPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    signals: Array<Record<string, unknown>>;
  }>('/signals?limit=100', {
    signals: [],
  });

  return (
    <section className="card">
      <h2>Recent Signals</h2>
      {unavailable ? (
        <p className="status-line">
          Recent signals are temporarily unavailable while the backend API
          reconnects.
        </p>
      ) : null}
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
          {data.signals.length === 0 ? (
            <tr className="table-empty-row">
              <td colSpan={6} className="muted">
                No signal data is available right now.
              </td>
            </tr>
          ) : null}
          {data.signals.map((signal) => {
            const formula = signal.formula_inputs as Record<
              string,
              number | null
            >;

            return (
              <tr key={String(signal.id)}>
                <td data-label="Symbol">{String(signal.symbol)}</td>
                <td data-label="Type">{String(signal.signal_type)}</td>
                <td data-label="Time">
                  {formatDateTime(String(signal.candle_close_time))}
                </td>
                <td data-label="Approved">
                  <span className={signal.approved ? 'pill' : 'pill pill-warn'}>
                    {signal.approved === null
                      ? 'Pending'
                      : signal.approved
                        ? 'Approved'
                        : 'Rejected'}
                  </span>
                </td>
                <td data-label="Reason">
                  {String(signal.rejection_reason ?? signal.reason)}
                </td>
                <td data-label="Formula">
                  r_t={formula.r_t?.toFixed?.(6) ?? 'n/a'} / B_t=
                  {formula.B_t?.toFixed?.(6) ?? 'n/a'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
