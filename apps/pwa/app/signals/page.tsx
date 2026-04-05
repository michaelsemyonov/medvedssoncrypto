import Link from 'next/link';
import { Alert, Button, Card, Descriptions, Empty, Flex } from 'antd';

import { CandleChart } from '@/components/candle-chart.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';
import { Eyebrow, StatusTag } from '@/components/ui-primitives.tsx';

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
    <Card className="surface-card" styles={{ body: { padding: 20 } }}>
      <h2>Recent Signals</h2>
      {unavailable ? (
        <Alert
          description="Recent signals are temporarily unavailable while the backend API reconnects."
          showIcon
          type="warning"
        />
      ) : null}
      {signals.length === 0 ? (
        <Empty
          description={
            currentPage > 1
              ? 'No signals were found on this page.'
              : 'No signal data is available right now.'
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="signal-list">
          {signals.map((signal) => (
            <Card
              className="surface-card"
              key={signal.id}
              styles={{ body: { padding: 18 } }}
            >
              <div className="signal-card">
                <div className="signal-summary">
                  <div className="signal-head">
                    <div>
                      <Eyebrow>{signal.signal_type}</Eyebrow>
                      <h3 className="signal-symbol">{signal.symbol}</h3>
                    </div>
                    <StatusTag
                      tone={
                        signal.approved === true
                          ? 'success'
                          : getApprovalClassName(signal.approved) === 'pill'
                            ? 'success'
                            : 'warning'
                      }
                    >
                      {getApprovalLabel(signal.approved)}
                    </StatusTag>
                  </div>
                  <Descriptions
                    className="signal-descriptions"
                    column={{ lg: 3, md: 2, sm: 1, xs: 1 }}
                    items={[
                      {
                        key: 'time',
                        label: 'Time',
                        children: formatDateTime(signal.created_at),
                      },
                      {
                        key: 'reason',
                        label: 'Reason',
                        children: signal.rejection_reason ?? signal.reason,
                      },
                      {
                        key: 'formula',
                        label: 'Formula',
                        children: `r_t=${formatFormulaValue(signal.formula_inputs.r_t)} / B_t=${formatFormulaValue(signal.formula_inputs.B_t)}`,
                      },
                    ]}
                  />
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
              </div>
            </Card>
          ))}
        </div>
      )}
      {showPagination ? (
        <Flex
          align="center"
          className="signals-pagination"
          gap={16}
          justify="space-between"
        >
          <span className="muted">Page {currentPage}</span>
          <div className="chip-grid">
            {currentPage > 1 ? (
              <Link href={previousPageHref}>
                <Button>Previous</Button>
              </Link>
            ) : (
              <Button disabled>Previous</Button>
            )}
            {hasNextPage ? (
              <Link href={nextPageHref}>
                <Button>Next</Button>
              </Link>
            ) : (
              <Button disabled>Next</Button>
            )}
          </div>
        </Flex>
      ) : null}
    </Card>
  );
}
