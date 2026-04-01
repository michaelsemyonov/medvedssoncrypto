import Link from 'next/link';

import { CandleChart } from '@/components/candle-chart.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';

export const dynamic = 'force-dynamic';

const SIGNALS_PER_PAGE = 10;
const SIGNALS_PAGE_LOOKAHEAD = SIGNALS_PER_PAGE + 1;

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
  created_at: string;
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

const getPageNumber = (value: string | string[] | undefined): number => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return 1;
  }

  return parsedValue;
};

const getSignalsPageHref = (page: number): string =>
  page <= 1 ? '/signals' : `/signals?page=${page}`;

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const params = await searchParams;
  const currentPage = getPageNumber(params.page);
  const offset = (currentPage - 1) * SIGNALS_PER_PAGE;
  const { data, unavailable } = await fetchApiWithFallback<{
    signals: SignalPageItem[];
  }>(`/signals?limit=${SIGNALS_PAGE_LOOKAHEAD}&offset=${offset}`, {
    signals: [],
  });
  const signals = data.signals.slice(0, SIGNALS_PER_PAGE);
  const hasNextPage = data.signals.length > SIGNALS_PER_PAGE;
  const showPagination = currentPage > 1 || hasNextPage;
  const previousPageHref = getSignalsPageHref(currentPage - 1);
  const nextPageHref = getSignalsPageHref(currentPage + 1);

  return (
    <section className="card">
      <h2>Recent Signals</h2>
      {unavailable ? (
        <p className="status-line">
          Recent signals are temporarily unavailable while the backend API
          reconnects.
        </p>
      ) : null}
      {signals.length === 0 ? (
        <p className="muted">
          {currentPage > 1
            ? 'No signals were found on this page.'
            : 'No signal data is available right now.'}
        </p>
      ) : (
        <div className="signal-list">
          {signals.map((signal) => (
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
                    <strong>{formatDateTime(signal.created_at)}</strong>
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
              <CandleChart
                ariaLabel="Candlestick chart for the latest 60 minutes before the signal"
                candles={signal.recent_candles}
                emptyMessage="No stored candles are available for this signal yet."
                footerLabel="Signal candle highlighted"
                highlightLastCandle
                summary={`${signal.recent_candles.length}/12 candles`}
                title="Latest 60 min"
              />
            </article>
          ))}
        </div>
      )}
      {showPagination ? (
        <nav className="signals-pagination" aria-label="Signals pagination">
          <span className="muted">Page {currentPage}</span>
          <div className="chip-grid">
            {currentPage > 1 ? (
              <Link className="chip" href={previousPageHref}>
                Previous
              </Link>
            ) : (
              <span className="chip chip-disabled" aria-disabled="true">
                Previous
              </span>
            )}
            {hasNextPage ? (
              <Link className="chip" href={nextPageHref}>
                Next
              </Link>
            ) : (
              <span className="chip chip-disabled" aria-disabled="true">
                Next
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
