import { Alert, Card, Col, Empty, Row, Statistic, Table } from 'antd';

import { fetchApiWithFallback } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/datetime.ts';
import { Eyebrow, StatusTag } from '@/components/ui-primitives.tsx';

export const dynamic = 'force-dynamic';

const formatSignedPnl = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)} USDT`;

export default async function DashboardPage() {
  const { data: dashboard, unavailable } = await fetchApiWithFallback<{
    activeSymbols: Array<{ symbol: string }>;
    latestSignals: Array<{
      symbol: string;
      signal_type: string;
      candle_close_time: string;
      created_at: string;
      approved: boolean | null;
    }>;
    openPositionsCount: number;
    todayCounterOrdersRealizedPnl: number;
    todayRealizedPnl: number;
    stats: {
      closedTrades: number;
      winRate: number;
      averageTradeReturn: number;
      totalRealizedPnl: number;
      equity: number;
      maxDrawdownPct: number;
    };
  }>('/dashboard', {
    activeSymbols: [],
    latestSignals: [],
    openPositionsCount: 0,
    todayCounterOrdersRealizedPnl: 0,
    todayRealizedPnl: 0,
    stats: {
      closedTrades: 0,
      winRate: 0,
      averageTradeReturn: 0,
      totalRealizedPnl: 0,
      equity: 0,
      maxDrawdownPct: 0,
    },
  });

  const latestSignals = dashboard.latestSignals.map((item) => ({
    approval: (
      <StatusTag
        tone={
          item.approved === true
            ? 'success'
            : item.approved === false
              ? 'warning'
              : 'warning'
        }
      >
        {item.approved === null
          ? 'Pending'
          : item.approved
            ? 'Approved'
            : 'Rejected'}
      </StatusTag>
    ),
    signal: item.signal_type,
    symbol: item.symbol,
    time: formatDateTime(item.created_at),
  }));

  return (
    <div className="stack-lg">
      {unavailable ? (
        <Alert
          description="Dashboard data is temporarily unavailable while the backend API reconnects."
          showIcon
          title="Temporary Degradation"
          type="warning"
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col lg={6} md={12} xs={24}>
          <Card className="surface-card" styles={{ body: { padding: 20 } }}>
            <Eyebrow>Today's PnL</Eyebrow>
            <Statistic
              styles={{ content: { fontSize: 'clamp(1.85rem, 7vw, 2.6rem)' } }}
              value={formatSignedPnl(dashboard.todayRealizedPnl)}
            />
            <p className="muted">Realized PnL for trades closed today.</p>
          </Card>
        </Col>
        <Col lg={6} md={12} xs={24}>
          <Card className="surface-card" styles={{ body: { padding: 20 } }}>
            <Eyebrow>Counter-Orders PnL</Eyebrow>
            <Statistic
              styles={{ content: { fontSize: 'clamp(1.85rem, 7vw, 2.6rem)' } }}
              value={formatSignedPnl(dashboard.todayCounterOrdersRealizedPnl)}
            />
            <p className="muted">
              Realized PnL from counter positions closed today.
            </p>
          </Card>
        </Col>
        <Col lg={6} md={12} xs={24}>
          <Card className="surface-card" styles={{ body: { padding: 20 } }}>
            <Eyebrow>Open Dry-Run Positions</Eyebrow>
            <Statistic
              styles={{ content: { fontSize: 'clamp(1.85rem, 7vw, 2.6rem)' } }}
              value={dashboard.openPositionsCount}
            />
            <p className="muted">
              Single position per symbol, next-open fill model.
            </p>
          </Card>
        </Col>
        <Col lg={6} md={12} xs={24}>
          <Card className="surface-card" styles={{ body: { padding: 20 } }}>
            <Eyebrow>Win Rate</Eyebrow>
            <Statistic
              styles={{ content: { fontSize: 'clamp(1.85rem, 7vw, 2.6rem)' } }}
              value={`${Number(dashboard.stats.winRate ?? 0).toFixed(1)}%`}
            />
            <p className="muted">
              {dashboard.stats.closedTrades} simulated trades closed today.
            </p>
          </Card>
        </Col>
      </Row>

      <Card className="surface-card" styles={{ body: { padding: 20 } }}>
        <h2>Latest Signal Per Symbol</h2>
        <Table
          columns={[
            {
              dataIndex: 'symbol',
              key: 'symbol',
              title: 'Symbol',
            },
            {
              dataIndex: 'signal',
              key: 'signal',
              title: 'Signal',
            },
            {
              dataIndex: 'time',
              key: 'time',
              title: 'Time',
            },
            {
              dataIndex: 'approval',
              key: 'approval',
              title: 'Approval',
            },
          ]}
          dataSource={latestSignals}
          locale={{
            emptyText: (
              <Empty
                description="No signal data is available right now."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={false}
          rowKey="symbol"
          scroll={{ x: 640 }}
        />
      </Card>
    </div>
  );
}
