import { SignalCandleChart } from '@/components/signal-candle-chart.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';

export const dynamic = 'force-dynamic';

type SignalPageCandle = {
  close: number;
  closeTime: string;
  high: number;
  low: number;
  open: number;
};

type SignalPageItem = {
  approved: boolean | null;
  candle_close_time: string;
  formula_inputs: Record<string, number | null>;
  id: string;
  reason: string;
  recent_candles: SignalPageCandle[];
  rejection_reason: string | null;
  signal_type: string;
  symbol: string;
};

const formatFormulaValue = (value: number | null | undefined): string =>
  typeof value === 'number' ? value.toFixed(6) : 'n/a';

const getApprovalLabel = (approved: boolean | null): string => {
  if (approved === null) {
    return 'Pending';
  }

  return approved ? 'Approved' : 'Rejected';
};

const getApprovalClassName = (approved: boolean | null): string => {
  if (approved === true) {
    return 'pill';
  }

  return 'pill pill-warn';
};

export default async function SignalsPage() {
  const { data, unavailable } = await fetchApiWithFallback<{
    signals: SignalPageItem[];
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
      {data.signals.length === 0 ? (
        <p className="muted">No signal data is available right now.</p>
      ) : (
        <div className="signal-list">
          {data.signals.map((signal) => (
            <article className="signal-card" key={signal.id}>
              <div className="signal-summary">
                <div className="signal-head">
                  <div>
                    <p className="eyebrow">{signal.signal_type}</p>
                    <h3 className="signal-symbol">{signal.symbol}</h3>
                  </div>
                  <span className={getApprovalClassName(signal.approved)}>
                    {getApprovalLabel(signal.approved)}
                  </span>
                </div>
                <div className="signal-grid">
                  <div className="signal-field">
                    <span className="signal-field-label">Time</span>
                    <strong>{formatDateTime(signal.candle_close_time)}</strong>
                  </div>
                  <div className="signal-field">
                    <span className="signal-field-label">Reason</span>
                    <strong>{signal.rejection_reason ?? signal.reason}</strong>
                  </div>
                  <div className="signal-field">
                    <span className="signal-field-label">Formula</span>
                    <strong>
                      r_t={formatFormulaValue(signal.formula_inputs.r_t)} / B_t=
                      {formatFormulaValue(signal.formula_inputs.B_t)}
                    </strong>
                  </div>
                </div>
              </div>
              <SignalCandleChart candles={signal.recent_candles} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
