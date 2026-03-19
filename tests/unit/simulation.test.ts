import { POSITION_SIDES } from '@medvedsson/shared';
import { adjustForSlippage, buildPendingOrder, calculateTradePnl } from '@medvedsson/execution';

describe('simulation engine', () => {
  it('fills at next-open with slippage and fees', () => {
    const price = adjustForSlippage(100, 'BUY', 5);
    expect(price).toBeCloseTo(100.05, 8);

    const order = buildPendingOrder(
      'LONG_ENTRY',
      100,
      {
        fillModel: 'next_open',
        feeRate: 0.001,
        slippageBps: 5,
        fixedUsdtPerTrade: 100,
        equityStartUsdt: 10000
      },
      '2026-01-01T01:00:00.000Z',
      null
    );

    expect(order.qty).toBeGreaterThan(0);
    expect(order.meta.scheduled_for_open_time).toBe('2026-01-01T01:00:00.000Z');
  });

  it('computes trade pnl including fees', () => {
    const pnl = calculateTradePnl(POSITION_SIDES.LONG, 100, 110, 1, 0.1, 0.11);
    expect(pnl.grossPnl).toBeCloseTo(10, 8);
    expect(pnl.realizedPnl).toBeCloseTo(9.79, 8);
  });
});
