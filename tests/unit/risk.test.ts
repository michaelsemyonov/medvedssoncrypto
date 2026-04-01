import {
  POSITION_SIDES,
  SIGNAL_TYPES,
  type StrategySignal,
} from '@medvedsson/shared';
import { evaluateRisk } from '@medvedsson/execution';

const baseSignal: StrategySignal = {
  signalType: SIGNAL_TYPES.LONG_ENTRY,
  candleCloseTime: '2026-01-01T00:05:00.000Z',
  signalStrength: 2,
  formulaInputs: {
    r_t: 0.05,
    B_t: 0.005,
    N: 96,
    k: 5,
    H: 72,
    threshold: 0.025,
    comparison: 'LONG',
  },
  indicators: {
    return: 0.05,
    baselineMoveMagnitude: 0.005,
  },
  features: {},
  reason: 'LONG threshold breached.',
};

describe('risk engine', () => {
  it('rejects entries when shorting is disabled or position already exists', () => {
    const shortDecision = evaluateRisk({
      signal: { ...baseSignal, signalType: SIGNAL_TYPES.SHORT_ENTRY },
      symbolEnabled: true,
      enoughHistory: true,
      allowShort: false,
      maxOpenPositions: 5,
      openPositionsCount: 0,
      openPosition: null,
      cooldownRemainingBars: 0,
      currentDrawdownPct: 0,
      maxDailyDrawdownPct: 5,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 5,
    });

    const duplicateDecision = evaluateRisk({
      signal: baseSignal,
      symbolEnabled: true,
      enoughHistory: true,
      allowShort: true,
      maxOpenPositions: 5,
      openPositionsCount: 1,
      openPosition: {
        id: 'pos',
        side: POSITION_SIDES.LONG,
        entryTime: '2026-01-01T00:00:00.000Z',
        entryPrice: 100,
        qty: 1,
        notionalUsdt: 100,
        entryFee: 0.1,
        broker: 'bybit',
        isCounterPosition: false,
      },
      cooldownRemainingBars: 0,
      currentDrawdownPct: 0,
      maxDailyDrawdownPct: 5,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 5,
    });

    expect(shortDecision.approved).toBe(false);
    expect(shortDecision.rejectionCode).toBe('SHORT_DISABLED');
    expect(duplicateDecision.rejectionCode).toBe('POSITION_ALREADY_OPEN');
  });

  it('approves valid entry signals', () => {
    const decision = evaluateRisk({
      signal: baseSignal,
      symbolEnabled: true,
      enoughHistory: true,
      allowShort: true,
      maxOpenPositions: 5,
      openPositionsCount: 0,
      openPosition: null,
      cooldownRemainingBars: 0,
      currentDrawdownPct: 0,
      maxDailyDrawdownPct: 5,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 5,
    });

    expect(decision.approved).toBe(true);
    expect(decision.rejectionCode).toBeNull();
  });
});
