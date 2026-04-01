import { POSITION_SIDES, SIGNAL_TYPES } from '@medvedsson/shared';
import {
  computeBaselineMagnitude,
  computeReturn,
  evaluateMomentumStrategy,
} from '@medvedsson/strategy';

import { generateCandles } from '../helpers.ts';

describe('strategy formula', () => {
  it('computes returns and baseline magnitude using the exact 96-bar definition', () => {
    expect(computeReturn(105, 100)).toBeCloseTo(0.05, 10);
    expect(computeBaselineMagnitude([0.01, -0.02, 0.03], 3)).toBeCloseTo(
      0.02,
      10
    );
  });

  it('emits LONG when r_t exceeds 5 x B_t', () => {
    const closes = Array.from({ length: 97 }, () => 100);
    closes.push(105);
    const signal = evaluateMomentumStrategy(
      generateCandles(closes),
      {
        n: 96,
        k: 5,
        hBars: 72,
        timeframe: '5m',
      },
      null
    );

    expect(signal.signalType).toBe(SIGNAL_TYPES.LONG_ENTRY);
    expect(signal.formulaInputs.r_t).toBeCloseTo(0.05, 10);
    expect(signal.formulaInputs.B_t).toBeCloseTo(0, 10);
  });

  it('emits exit after 72 bars for an open position', () => {
    const candles = generateCandles(Array.from({ length: 110 }, () => 100));
    const signal = evaluateMomentumStrategy(
      candles,
      {
        n: 96,
        k: 5,
        hBars: 72,
        timeframe: '5m',
      },
      {
        id: 'pos-1',
        side: POSITION_SIDES.LONG,
        entryTime: candles[37]!.closeTime,
        entryPrice: 100,
        qty: 1,
        notionalUsdt: 100,
        entryFee: 0.1,
        broker: 'bybit',
        isCounterPosition: false,
      }
    );

    expect(signal.signalType).toBe(SIGNAL_TYPES.LONG_EXIT);
  });
});
