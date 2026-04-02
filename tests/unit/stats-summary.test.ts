import { createFakeDatabase } from '../fake-db.ts';

describe('stats summary aggregation', () => {
  it('aggregates closed trades across all runs when no run id is provided', async () => {
    const db = createFakeDatabase() as any;

    db.positions.push(
      {
        id: 'position-1',
        strategy_run_id: 'run-1',
        symbol_id: 'symbol-1',
        side: 'LONG',
        status: 'CLOSED',
        entry_time: new Date('2026-01-01T00:00:00.000Z'),
        exit_time: new Date('2026-01-01T01:00:00.000Z'),
        entry_price: 100,
        exit_price: 110,
        qty: 1,
        notional_usdt: 100,
        entry_fee: 0,
        exit_fee: 0,
        realized_pnl: 10,
        opened_by_signal_id: 'signal-1',
        closed_by_signal_id: 'signal-2',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T01:00:00.000Z'),
      },
      {
        id: 'position-2',
        strategy_run_id: 'run-2',
        symbol_id: 'symbol-1',
        side: 'LONG',
        status: 'CLOSED',
        entry_time: new Date('2026-01-02T00:00:00.000Z'),
        exit_time: new Date('2026-01-02T01:00:00.000Z'),
        entry_price: 100,
        exit_price: 95,
        qty: 1,
        notional_usdt: 100,
        entry_fee: 0,
        exit_fee: 0,
        realized_pnl: -5,
        opened_by_signal_id: 'signal-3',
        closed_by_signal_id: 'signal-4',
        created_at: new Date('2026-01-02T00:00:00.000Z'),
        updated_at: new Date('2026-01-02T01:00:00.000Z'),
      }
    );

    db.equitySnapshots.push(
      {
        id: 'snapshot-1',
        strategy_run_id: 'run-1',
        snapshot_time: new Date('2026-01-01T01:00:00.000Z'),
        balance_usdt: 1010,
        equity_usdt: 1010,
        unrealized_pnl: 0,
        realized_pnl_cum: 10,
        drawdown_pct: 2.5,
        open_positions: 0,
      },
      {
        id: 'snapshot-2',
        strategy_run_id: 'run-2',
        snapshot_time: new Date('2026-01-02T01:00:00.000Z'),
        balance_usdt: 995,
        equity_usdt: 995,
        unrealized_pnl: 0,
        realized_pnl_cum: -5,
        drawdown_pct: 4,
        open_positions: 0,
      }
    );

    await expect(db.getStatsSummary('run-2', 1000)).resolves.toMatchObject({
      closedTrades: 1,
      winRate: 0,
      totalRealizedPnl: -5,
      equity: 995,
      maxDrawdownPct: 4,
    });

    await expect(db.getStatsSummary(null, 1000)).resolves.toMatchObject({
      closedTrades: 2,
      winRate: 50,
      totalRealizedPnl: 5,
      equity: 1005,
      maxDrawdownPct: 4,
    });
  });

  it('can scope the summary to trades closed inside a time window', async () => {
    const db = createFakeDatabase() as any;

    db.positions.push(
      {
        id: 'position-1',
        strategy_run_id: 'run-1',
        symbol_id: 'symbol-1',
        side: 'LONG',
        status: 'CLOSED',
        entry_time: new Date('2026-01-01T22:30:00.000Z'),
        exit_time: new Date('2026-01-01T23:30:00.000Z'),
        entry_price: 100,
        exit_price: 110,
        qty: 1,
        notional_usdt: 100,
        entry_fee: 0,
        exit_fee: 0,
        realized_pnl: 10,
        opened_by_signal_id: 'signal-1',
        closed_by_signal_id: 'signal-2',
        created_at: new Date('2026-01-01T22:30:00.000Z'),
        updated_at: new Date('2026-01-01T23:30:00.000Z'),
      },
      {
        id: 'position-2',
        strategy_run_id: 'run-1',
        symbol_id: 'symbol-1',
        side: 'LONG',
        status: 'CLOSED',
        entry_time: new Date('2026-01-02T08:00:00.000Z'),
        exit_time: new Date('2026-01-02T09:00:00.000Z'),
        entry_price: 100,
        exit_price: 95,
        qty: 1,
        notional_usdt: 100,
        entry_fee: 0,
        exit_fee: 0,
        realized_pnl: -5,
        opened_by_signal_id: 'signal-3',
        closed_by_signal_id: 'signal-4',
        created_at: new Date('2026-01-02T08:00:00.000Z'),
        updated_at: new Date('2026-01-02T09:00:00.000Z'),
      }
    );

    db.equitySnapshots.push(
      {
        id: 'snapshot-1',
        strategy_run_id: 'run-1',
        snapshot_time: new Date('2026-01-01T23:30:00.000Z'),
        balance_usdt: 1010,
        equity_usdt: 1010,
        unrealized_pnl: 0,
        realized_pnl_cum: 10,
        drawdown_pct: 1.5,
        open_positions: 0,
      },
      {
        id: 'snapshot-2',
        strategy_run_id: 'run-1',
        snapshot_time: new Date('2026-01-02T09:00:00.000Z'),
        balance_usdt: 995,
        equity_usdt: 995,
        unrealized_pnl: 0,
        realized_pnl_cum: -5,
        drawdown_pct: 4,
        open_positions: 0,
      }
    );

    await expect(
      db.getStatsSummary(null, 1000, {
        startTime: '2026-01-02T00:00:00.000Z',
        endTime: '2026-01-03T00:00:00.000Z',
      })
    ).resolves.toMatchObject({
      closedTrades: 1,
      winRate: 0,
      totalRealizedPnl: -5,
      equity: 995,
      maxDrawdownPct: 4,
    });
  });
});
