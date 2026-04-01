import {
  calcLongProfitPct,
  calcShortProfitPct,
  calcProfitPct,
  clamp,
  evaluateExit,
  updateMaxFavorablePrice,
  DEFAULT_EXIT_CONFIG,
  TRAILING_PROFILES,
} from '@medvedsson/exit-manager';
import type {
  OpenPosition,
  MarketContext,
  ExitConfig,
  ExitDecision,
} from '@medvedsson/exit-manager';

import { generateCandles } from '../helpers.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCandle = (close: number, high?: number, low?: number) => {
  const candles = generateCandles([close]);
  const candle = candles[0]!;
  return {
    ...candle,
    high: high ?? candle.high,
    low: low ?? candle.low,
  };
};

const makeLongPosition = (
  overrides: Partial<OpenPosition> = {}
): OpenPosition => ({
  symbol: 'BTC/USDT',
  side: 'LONG',
  entryPrice: 100,
  quantity: 1,
  entryTime: '2026-01-01T00:00:00.000Z',
  entryCandleCloseTime: '2026-01-01T00:05:00.000Z',
  barsHeld: 0,
  trailingArmed: false,
  maxFavorablePrice: 100,
  maxFavorableProfitPct: 0,
  ...overrides,
});

const makeShortPosition = (
  overrides: Partial<OpenPosition> = {}
): OpenPosition => ({
  symbol: 'BTC/USDT',
  side: 'SHORT',
  entryPrice: 100,
  quantity: 1,
  entryTime: '2026-01-01T00:00:00.000Z',
  entryCandleCloseTime: '2026-01-01T00:05:00.000Z',
  barsHeld: 0,
  trailingArmed: false,
  maxFavorablePrice: 100,
  maxFavorableProfitPct: 0,
  ...overrides,
});

const makeMarket = (
  close: number,
  high?: number,
  low?: number,
  atrPct?: number
): MarketContext => {
  const candle = makeCandle(close, high, low);
  return {
    candles: [candle],
    latestClosedCandle: candle,
    atrPct,
  };
};

const balancedConfig: ExitConfig = { ...DEFAULT_EXIT_CONFIG };

// ---------------------------------------------------------------------------
// Helper function unit tests
// ---------------------------------------------------------------------------

describe('clamp', () => {
  it('returns the value when within bounds', () => {
    expect(clamp(5, 1, 10)).toBe(5);
  });

  it('clamps to the minimum', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it('clamps to the maximum', () => {
    expect(clamp(20, 0, 10)).toBe(10);
  });

  it('works when min equals max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe('calcLongProfitPct', () => {
  it('returns positive profit when price goes up', () => {
    expect(calcLongProfitPct(100, 102)).toBeCloseTo(2.0, 6);
  });

  it('returns negative profit when price goes down', () => {
    expect(calcLongProfitPct(100, 98)).toBeCloseTo(-2.0, 6);
  });

  it('returns zero when price is unchanged', () => {
    expect(calcLongProfitPct(100, 100)).toBe(0);
  });

  it('returns correct percentage for large moves', () => {
    expect(calcLongProfitPct(100, 150)).toBeCloseTo(50.0, 6);
  });
});

describe('calcShortProfitPct', () => {
  it('returns positive profit when price goes down', () => {
    expect(calcShortProfitPct(100, 98)).toBeCloseTo(2.0, 6);
  });

  it('returns negative profit when price goes up', () => {
    expect(calcShortProfitPct(100, 102)).toBeCloseTo(-2.0, 6);
  });

  it('returns zero when price is unchanged', () => {
    expect(calcShortProfitPct(100, 100)).toBe(0);
  });
});

describe('calcProfitPct', () => {
  it('delegates to calcLongProfitPct for LONG', () => {
    expect(calcProfitPct('LONG', 100, 105)).toBeCloseTo(5.0, 6);
  });

  it('delegates to calcShortProfitPct for SHORT', () => {
    expect(calcProfitPct('SHORT', 100, 95)).toBeCloseTo(5.0, 6);
  });
});

describe('updateMaxFavorablePrice', () => {
  it('updates to new high for LONG', () => {
    expect(updateMaxFavorablePrice('LONG', 100, 105, 99)).toBe(105);
  });

  it('keeps previous max when candle high is lower for LONG', () => {
    expect(updateMaxFavorablePrice('LONG', 110, 105, 99)).toBe(110);
  });

  it('updates to new low for SHORT', () => {
    expect(updateMaxFavorablePrice('SHORT', 100, 105, 95)).toBe(95);
  });

  it('keeps previous min when candle low is higher for SHORT', () => {
    expect(updateMaxFavorablePrice('SHORT', 90, 105, 95)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – HOLD scenarios
// ---------------------------------------------------------------------------

describe('evaluateExit – HOLD', () => {
  it('returns HOLD when no exit condition is met and trailing is not armed', () => {
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(100.5),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.reason).toBe('hold_no_exit_condition');
    expect(result.diagnostics.trailingArmed).toBe(false);
    expect(result.nextPositionState).toBeDefined();
    expect(result.nextPositionState!.barsHeld).toBe(1);
  });

  it('returns HOLD with trailing_active_hold when trailing is armed but giveback is below threshold', () => {
    // Position already armed, entry at 100, peak was 102 (2%), close at 101.5 (1.5%)
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 102,
      maxFavorableProfitPct: 2.0,
      barsHeld: 3,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(101.5),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.reason).toBe('trailing_active_hold');
    expect(result.diagnostics.trailingArmed).toBe(true);
  });

  it('increments barsHeld in nextPositionState', () => {
    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 5 }),
      market: makeMarket(100),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.nextPositionState!.barsHeld).toBe(6);
  });

  it('updates maxFavorablePrice in nextPositionState for LONG when price rises', () => {
    const result = evaluateExit({
      position: makeLongPosition({ maxFavorablePrice: 100 }),
      market: makeMarket(100.5, 101, 99.5),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.nextPositionState!.maxFavorablePrice).toBe(101);
  });

  it('updates maxFavorablePrice in nextPositionState for SHORT when price drops', () => {
    const result = evaluateExit({
      position: makeShortPosition({ maxFavorablePrice: 100 }),
      market: makeMarket(99.5, 100.2, 99.3),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.nextPositionState!.maxFavorablePrice).toBe(99.3);
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – Trailing activation
// ---------------------------------------------------------------------------

describe('evaluateExit – trailing activation', () => {
  it('arms trailing when peak profit reaches activation threshold (LONG)', () => {
    // Entry at 100, close at 101.2 -> 1.2% profit which equals the default activation threshold
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(101.2),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.trailingArmed).toBe(true);
    expect(result.diagnostics.trailingArmedAtProfitPct).toBeCloseTo(1.2, 1);
    expect(result.nextPositionState!.trailingArmed).toBe(true);
  });

  it('does not arm trailing when profit is below activation threshold', () => {
    // Entry at 100, close at 101.0 -> 1.0% profit, below 1.2% threshold
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(101.0),
      config: balancedConfig,
    });

    expect(result.diagnostics.trailingArmed).toBe(false);
    expect(result.nextPositionState!.trailingArmed).toBe(false);
  });

  it('arms trailing when intra-candle high reaches activation threshold even if close does not', () => {
    // Entry at 100, close at 101.0 (1%), but high reached 101.3 (1.3% > 1.2% threshold)
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(101.0, 101.3, 100.8),
      config: balancedConfig,
    });

    expect(result.diagnostics.trailingArmed).toBe(true);
    expect(result.diagnostics.peakProfitPct).toBeGreaterThanOrEqual(1.2);
  });

  it('does not arm trailing when trailing is disabled', () => {
    const config: ExitConfig = {
      trailing: {
        ...TRAILING_PROFILES.BALANCED,
        enabled: false,
      },
    };

    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(105), // 5% profit
      config,
    });

    expect(result.diagnostics.trailingArmed).toBe(false);
  });

  it('arms trailing for SHORT when price drops enough', () => {
    // Entry at 100, close at 98.8 -> short profit 1.2%
    const result = evaluateExit({
      position: makeShortPosition(),
      market: makeMarket(98.8, 99, 98.8),
      config: balancedConfig,
    });

    expect(result.diagnostics.trailingArmed).toBe(true);
    expect(result.diagnostics.currentProfitPct).toBeCloseTo(1.2, 1);
  });

  it('sets trailingArmedAt timestamp when first armed', () => {
    const market = makeMarket(101.5);
    const result = evaluateExit({
      position: makeLongPosition(),
      market,
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.nextPositionState!.trailingArmedAt).toBe(
      market.latestClosedCandle.closeTime
    );
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – EXIT_TRAILING_PROFIT
// ---------------------------------------------------------------------------

describe('evaluateExit – EXIT_TRAILING_PROFIT', () => {
  it('exits when giveback exceeds adaptive threshold and profit floor is met', () => {
    // Entry 100, peak was 103 (3%), now close at 101.5 (1.5%)
    // giveback = 3 - 1.5 = 1.5
    // allowed = clamp(3 * 0.35, 0.4, 1.5) = clamp(1.05, 0.4, 1.5) = 1.05
    // giveback 1.5 >= allowed 1.05 ✓
    // currentProfit 1.5 >= minLocked 0.4 ✓
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 103,
      maxFavorableProfitPct: 3.0,
      barsHeld: 5,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(101.5),
      config: balancedConfig,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
    expect(result.reason).toBe('trailing_profit_giveback_exceeded');
    expect(result.diagnostics.givebackPct).toBeCloseTo(1.5, 1);
    expect(result.diagnostics.allowedGivebackPct).toBeCloseTo(1.05, 1);
  });

  it('does not exit when giveback is below threshold', () => {
    // Entry 100, peak was 103 (3%), close at 102.5 (2.5%)
    // giveback = 0.5
    // allowed = clamp(3 * 0.35, 0.4, 1.5) = 1.05
    // giveback 0.5 < allowed 1.05 → HOLD
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 103,
      maxFavorableProfitPct: 3.0,
      barsHeld: 5,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(102.5),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
  });

  it('does not exit when profit floor is not met', () => {
    // Entry 100, peak was 101.3 (1.3%), close at 100.1 (0.1%)
    // giveback = 1.3 - 0.1 = 1.2
    // allowed = clamp(1.3 * 0.35, 0.4, 1.5) = clamp(0.455, 0.4, 1.5) = 0.455
    // giveback 1.2 >= allowed 0.455 ✓
    // currentProfit 0.1 < minLocked 0.4 ✗ → HOLD
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 101.3,
      maxFavorableProfitPct: 1.3,
      barsHeld: 3,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(100.1),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
  });

  it('exits trailing profit for SHORT position when price bounces up', () => {
    // Entry 100, peak favorable price was 97 (3% short profit), close now at 98.5 (1.5% short profit)
    // giveback = 3 - 1.5 = 1.5
    // allowed = clamp(3 * 0.35, 0.4, 1.5) = 1.05
    // giveback 1.5 >= allowed 1.05 ✓
    // currentProfit 1.5 >= minLocked 0.4 ✓
    const position = makeShortPosition({
      trailingArmed: true,
      maxFavorablePrice: 97,
      maxFavorableProfitPct: 3.0,
      barsHeld: 5,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(98.5, 99, 98),
      config: balancedConfig,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
    expect(result.diagnostics.currentProfitPct).toBeCloseTo(1.5, 1);
  });

  it('uses giveback_min_pct as floor for allowed giveback on small peaks', () => {
    // Entry 100, peak at 100.5 (0.5%), but already armed from a prior candle
    // Actually use peak at 101.2 (1.2%) exactly at activation
    // allowed = clamp(1.2 * 0.35, 0.4, 1.5) = clamp(0.42, 0.4, 1.5) = 0.42
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 101.2,
      maxFavorableProfitPct: 1.2,
      barsHeld: 2,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(100.7),
      config: balancedConfig,
    });

    // giveback = 1.2 - 0.7 = 0.5
    // allowed = 0.42
    // giveback >= allowed ✓, currentProfit 0.7 >= 0.4 ✓
    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
    expect(result.diagnostics.allowedGivebackPct).toBeCloseTo(0.42, 2);
  });

  it('uses giveback_max_pct as ceiling for allowed giveback on large peaks', () => {
    // Entry 100, peak at 110 (10%)
    // allowed = clamp(10 * 0.35, 0.4, 1.5) = clamp(3.5, 0.4, 1.5) = 1.5
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 110,
      maxFavorableProfitPct: 10.0,
      barsHeld: 20,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(108), // 8% profit, giveback = 2.0
      config: balancedConfig,
    });

    expect(result.diagnostics.allowedGivebackPct).toBeCloseTo(1.5, 2);
    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – EXIT_STOP
// ---------------------------------------------------------------------------

describe('evaluateExit – EXIT_STOP', () => {
  it('exits immediately when hardStopHit is true', () => {
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(95),
      config: balancedConfig,
      hardStopHit: true,
    });

    expect(result.action).toBe('EXIT_STOP');
    expect(result.reason).toBe('hard_stop_hit');
  });

  it('EXIT_STOP takes priority over trailing profit exit', () => {
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 103,
      maxFavorableProfitPct: 3.0,
      barsHeld: 5,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(101.5), // would trigger trailing exit
      config: balancedConfig,
      hardStopHit: true,
    });

    expect(result.action).toBe('EXIT_STOP');
  });

  it('EXIT_STOP takes priority over signal reversal', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      allowSignalReversalExit: true,
    };

    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(95),
      config,
      signalExit: true,
      hardStopHit: true,
    });

    expect(result.action).toBe('EXIT_STOP');
  });

  it('EXIT_STOP takes priority over time stop', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      maxBarsInTrade: 5,
    };

    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 10 }),
      market: makeMarket(95),
      config,
      hardStopHit: true,
    });

    expect(result.action).toBe('EXIT_STOP');
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – EXIT_SIGNAL_REVERSAL
// ---------------------------------------------------------------------------

describe('evaluateExit – EXIT_SIGNAL_REVERSAL', () => {
  it('exits on signal reversal when enabled and signalExit is true', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      allowSignalReversalExit: true,
    };

    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(99),
      config,
      signalExit: true,
    });

    expect(result.action).toBe('EXIT_SIGNAL_REVERSAL');
    expect(result.reason).toBe('signal_reversal');
  });

  it('does not exit on signal reversal when allowSignalReversalExit is false', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      allowSignalReversalExit: false,
    };

    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(99),
      config,
      signalExit: true,
    });

    expect(result.action).toBe('HOLD');
  });

  it('does not exit on signal reversal when signalExit is not provided', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      allowSignalReversalExit: true,
    };

    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(99),
      config,
    });

    expect(result.action).toBe('HOLD');
  });

  it('trailing profit exit takes priority over signal reversal', () => {
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 103,
      maxFavorableProfitPct: 3.0,
      barsHeld: 5,
    });

    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      allowSignalReversalExit: true,
    };

    const result = evaluateExit({
      position,
      market: makeMarket(101.5),
      config,
      signalExit: true,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – EXIT_TIME_STOP
// ---------------------------------------------------------------------------

describe('evaluateExit – EXIT_TIME_STOP', () => {
  it('exits when barsHeld reaches maxBarsInTrade', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      maxBarsInTrade: 72,
    };

    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 71 }), // +1 = 72
      market: makeMarket(100),
      config,
    });

    expect(result.action).toBe('EXIT_TIME_STOP');
    expect(result.reason).toBe('max_bars_in_trade_reached');
  });

  it('exits when barsHeld exceeds maxBarsInTrade', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      maxBarsInTrade: 10,
    };

    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 15 }),
      market: makeMarket(100),
      config,
    });

    expect(result.action).toBe('EXIT_TIME_STOP');
  });

  it('does not exit when barsHeld is below maxBarsInTrade', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      maxBarsInTrade: 72,
    };

    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 70 }), // +1 = 71 < 72
      market: makeMarket(100),
      config,
    });

    expect(result.action).toBe('HOLD');
  });

  it('does not apply time stop when maxBarsInTrade is not set', () => {
    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 1000 }),
      market: makeMarket(100),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
  });

  it('trailing profit exit takes priority over time stop', () => {
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 103,
      maxFavorableProfitPct: 3.0,
      barsHeld: 71,
    });

    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      maxBarsInTrade: 72,
    };

    const result = evaluateExit({
      position,
      market: makeMarket(101.5),
      config,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
  });

  it('signal reversal takes priority over time stop', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      maxBarsInTrade: 5,
      allowSignalReversalExit: true,
    };

    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 10 }),
      market: makeMarket(100),
      config,
      signalExit: true,
    });

    expect(result.action).toBe('EXIT_SIGNAL_REVERSAL');
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – Diagnostics
// ---------------------------------------------------------------------------

describe('evaluateExit – diagnostics', () => {
  it('includes all required diagnostic fields on HOLD', () => {
    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 3 }),
      market: makeMarket(101, 101.5, 100.5, 1.5),
      config: balancedConfig,
    });

    const diag = result.diagnostics;
    expect(diag.entryPrice).toBe(100);
    expect(diag.currentClose).toBe(101);
    expect(diag.currentProfitPct).toBeCloseTo(1.0, 4);
    expect(diag.peakProfitPct).toBeGreaterThanOrEqual(1.0);
    expect(typeof diag.givebackPct).toBe('number');
    expect(typeof diag.trailingArmed).toBe('boolean');
    expect(diag.barsHeld).toBe(4);
    expect(diag.atrPct).toBe(1.5);
  });

  it('sets allowedGivebackPct to null when trailing is not armed', () => {
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(100.5),
      config: balancedConfig,
    });

    expect(result.diagnostics.allowedGivebackPct).toBeNull();
    expect(result.diagnostics.minLockedProfitPct).toBeNull();
  });

  it('sets allowedGivebackPct and minLockedProfitPct when trailing is armed', () => {
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 102,
      maxFavorableProfitPct: 2.0,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(101.8),
      config: balancedConfig,
    });

    expect(result.diagnostics.allowedGivebackPct).not.toBeNull();
    expect(result.diagnostics.minLockedProfitPct).toBe(0.4);
  });

  it('reports atrPct as undefined when not provided', () => {
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(100),
      config: balancedConfig,
    });

    expect(result.diagnostics.atrPct).toBeUndefined();
  });

  it('computes givebackPct as zero when trailing is not armed', () => {
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(99),
      config: balancedConfig,
    });

    expect(result.diagnostics.givebackPct).toBe(0);
  });

  it('reports correct peakProfitPct from previously stored max', () => {
    const position = makeLongPosition({
      maxFavorablePrice: 105,
      maxFavorableProfitPct: 5.0,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(103),
      config: balancedConfig,
    });

    expect(result.diagnostics.peakProfitPct).toBeCloseTo(5.0, 1);
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – Profile-specific behavior
// ---------------------------------------------------------------------------

describe('evaluateExit – trailing profiles', () => {
  it('conservative profile allows larger giveback before exit', () => {
    const config: ExitConfig = { trailing: TRAILING_PROFILES.CONSERVATIVE };

    // Peak 3%, close at 1.5% profit → giveback 1.5
    // allowed = clamp(3 * 0.45, 0.6, 2.0) = clamp(1.35, 0.6, 2.0) = 1.35
    // giveback 1.5 >= allowed 1.35 ✓ → would exit with conservative
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 103,
      maxFavorableProfitPct: 3.0,
      barsHeld: 5,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(101.5),
      config,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
    expect(result.diagnostics.allowedGivebackPct).toBeCloseTo(1.35, 2);
  });

  it('aggressive profile exits earlier on smaller giveback', () => {
    const config: ExitConfig = { trailing: TRAILING_PROFILES.AGGRESSIVE };

    // Peak 1.5%, close at 1.1% profit → giveback 0.4
    // allowed = clamp(1.5 * 0.25, 0.25, 1.0) = clamp(0.375, 0.25, 1.0) = 0.375
    // giveback 0.4 >= allowed 0.375 ✓
    // currentProfit 1.1 >= minLocked 0.25 ✓
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 101.5,
      maxFavorableProfitPct: 1.5,
      barsHeld: 3,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(101.1),
      config,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
    expect(result.diagnostics.allowedGivebackPct).toBeCloseTo(0.375, 3);
  });

  it('aggressive profile arms earlier than balanced', () => {
    const aggressiveConfig: ExitConfig = {
      trailing: TRAILING_PROFILES.AGGRESSIVE,
    };

    // Entry 100, close at 100.85 → 0.85% profit
    // Aggressive activation: 0.8% → armed
    // Balanced activation: 1.2% → not armed
    const position = makeLongPosition();
    const market = makeMarket(100.85);

    const aggressiveResult = evaluateExit({
      position,
      market,
      config: aggressiveConfig,
    });
    const balancedResult = evaluateExit({
      position,
      market,
      config: balancedConfig,
    });

    expect(aggressiveResult.diagnostics.trailingArmed).toBe(true);
    expect(balancedResult.diagnostics.trailingArmed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – SHORT position scenarios
// ---------------------------------------------------------------------------

describe('evaluateExit – SHORT positions', () => {
  it('calculates positive profit for SHORT when price drops', () => {
    const result = evaluateExit({
      position: makeShortPosition(),
      market: makeMarket(98, 99, 97),
      config: balancedConfig,
    });

    expect(result.diagnostics.currentProfitPct).toBeCloseTo(2.0, 1);
  });

  it('calculates negative profit for SHORT when price rises', () => {
    const result = evaluateExit({
      position: makeShortPosition(),
      market: makeMarket(102, 103, 101),
      config: balancedConfig,
    });

    expect(result.diagnostics.currentProfitPct).toBeCloseTo(-2.0, 1);
  });

  it('tracks maxFavorablePrice as lowest low for SHORT', () => {
    const result = evaluateExit({
      position: makeShortPosition({ maxFavorablePrice: 99 }),
      market: makeMarket(98, 99, 97),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.nextPositionState!.maxFavorablePrice).toBe(97);
  });

  it('arms trailing for SHORT when short profit exceeds activation threshold', () => {
    // Entry at 100, close at 98.5, low at 98 → short profit from low = 2%
    const result = evaluateExit({
      position: makeShortPosition(),
      market: makeMarket(98.5, 99, 98),
      config: balancedConfig,
    });

    expect(result.diagnostics.trailingArmed).toBe(true);
  });

  it('triggers trailing exit for SHORT when price bounces from lows', () => {
    // Entry 100, peak was at 96 (4% short profit), now at 98.5 (1.5% short profit)
    // giveback = 4 - 1.5 = 2.5
    // allowed = clamp(4 * 0.35, 0.4, 1.5) = clamp(1.4, 0.4, 1.5) = 1.4
    // giveback 2.5 >= allowed 1.4 ✓
    // currentProfit 1.5 >= minLocked 0.4 ✓
    const position = makeShortPosition({
      trailingArmed: true,
      maxFavorablePrice: 96,
      maxFavorableProfitPct: 4.0,
      barsHeld: 8,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(98.5, 99, 98),
      config: balancedConfig,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – Edge cases
// ---------------------------------------------------------------------------

describe('evaluateExit – edge cases', () => {
  it('handles entry price equal to current price (zero profit)', () => {
    const result = evaluateExit({
      position: makeLongPosition({ entryPrice: 100 }),
      market: makeMarket(100),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.currentProfitPct).toBe(0);
  });

  it('handles position with barsHeld = 0 (first evaluation)', () => {
    const result = evaluateExit({
      position: makeLongPosition({ barsHeld: 0 }),
      market: makeMarket(100),
      config: balancedConfig,
    });

    expect(result.diagnostics.barsHeld).toBe(1);
    expect(result.action).toBe('HOLD');
  });

  it('does not produce nextPositionState on EXIT actions', () => {
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(95),
      config: balancedConfig,
      hardStopHit: true,
    });

    expect(result.action).toBe('EXIT_STOP');
    expect(result.nextPositionState).toBeUndefined();
  });

  it('activation and exit can happen on the same candle if profit oscillated enough', () => {
    // Entry 100, maxFavorableProfitPct was 0 (never peaked before)
    // Now candle: high = 102 (2% peak), close = 100.5 (0.5%)
    // Peak = 2%, activation threshold 1.2% → armed
    // giveback = 2 - 0.5 = 1.5
    // allowed = clamp(2 * 0.35, 0.4, 1.5) = clamp(0.7, 0.4, 1.5) = 0.7
    // giveback 1.5 >= allowed 0.7 ✓
    // currentProfit 0.5 >= minLocked 0.4 ✓ → EXIT
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(100.5, 102, 100),
      config: balancedConfig,
    });

    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
    expect(result.diagnostics.trailingArmed).toBe(true);
  });

  it('handles very small entry prices without precision issues', () => {
    const position = makeLongPosition({
      entryPrice: 0.00001,
      maxFavorablePrice: 0.00001,
      maxFavorableProfitPct: 0,
    });

    const result = evaluateExit({
      position,
      market: makeMarket(0.0000102, 0.0000103, 0.0000099),
      config: balancedConfig,
    });

    expect(result.diagnostics.currentProfitPct).toBeCloseTo(2.0, 0);
    expect(result.action).toBe('HOLD');
  });

  it('handles already-armed position that continues to make new highs', () => {
    const position = makeLongPosition({
      trailingArmed: true,
      maxFavorablePrice: 103,
      maxFavorableProfitPct: 3.0,
      barsHeld: 10,
    });

    // New high of 105 → peak updates to 5%
    const result = evaluateExit({
      position,
      market: makeMarket(104.5, 105, 104),
      config: balancedConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.peakProfitPct).toBeCloseTo(5.0, 1);
    expect(result.nextPositionState!.maxFavorableProfitPct).toBeCloseTo(5.0, 1);
    expect(result.nextPositionState!.maxFavorablePrice).toBe(105);
  });

  it('hardStopHit=false is treated the same as not provided', () => {
    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(100),
      config: balancedConfig,
      hardStopHit: false,
    });

    expect(result.action).toBe('HOLD');
  });

  it('signalExit=false does not trigger signal reversal even when enabled', () => {
    const config: ExitConfig = {
      trailing: TRAILING_PROFILES.BALANCED,
      allowSignalReversalExit: true,
    };

    const result = evaluateExit({
      position: makeLongPosition(),
      market: makeMarket(100),
      config,
      signalExit: false,
    });

    expect(result.action).toBe('HOLD');
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – Adaptive giveback math
// ---------------------------------------------------------------------------

describe('evaluateExit – adaptive giveback calculations', () => {
  it('computes correct giveback for various peak sizes with balanced config', () => {
    const cases = [
      // [peakProfitPct, expectedAllowed]
      [1.2, 0.42], // 1.2 * 0.35 = 0.42, clamp(0.42, 0.4, 1.5) = 0.42
      [2.0, 0.7], // 2.0 * 0.35 = 0.70, clamp(0.70, 0.4, 1.5) = 0.70
      [3.0, 1.05], // 3.0 * 0.35 = 1.05, clamp(1.05, 0.4, 1.5) = 1.05
      [5.0, 1.5], // 5.0 * 0.35 = 1.75, clamp(1.75, 0.4, 1.5) = 1.50 (capped)
      [0.8, 0.4], // 0.8 * 0.35 = 0.28, clamp(0.28, 0.4, 1.5) = 0.40 (floored)
    ] as const;

    for (const [peak, expected] of cases) {
      const position = makeLongPosition({
        trailingArmed: true,
        maxFavorablePrice: 100 + peak,
        maxFavorableProfitPct: peak,
      });

      const result = evaluateExit({
        position,
        market: makeMarket(100 + peak * 0.99),
        config: balancedConfig,
      });

      expect(result.diagnostics.allowedGivebackPct).toBeCloseTo(expected, 2);
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateExit – Complete lifecycle scenario
// ---------------------------------------------------------------------------

describe('evaluateExit – lifecycle scenario', () => {
  it('walks through a complete LONG trade from entry to trailing exit', () => {
    const config = balancedConfig;

    // Bar 1: entry at 100, close at 100.3 (0.3% profit) → HOLD, not armed
    let position = makeLongPosition({
      entryPrice: 100,
      maxFavorablePrice: 100,
      maxFavorableProfitPct: 0,
      barsHeld: 0,
    });
    let result = evaluateExit({
      position,
      market: makeMarket(100.3, 100.4, 100.1),
      config,
    });
    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.trailingArmed).toBe(false);

    // Update position state
    position = { ...position, ...result.nextPositionState } as OpenPosition;

    // Bar 2: close at 101.0 (1.0% profit) → HOLD, not armed yet
    result = evaluateExit({
      position,
      market: makeMarket(101.0, 101.1, 100.8),
      config,
    });
    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.trailingArmed).toBe(false);

    position = { ...position, ...result.nextPositionState } as OpenPosition;

    // Bar 3: close at 101.5, high 101.6 (1.5%/1.6%) → HOLD, trailing armed!
    result = evaluateExit({
      position,
      market: makeMarket(101.5, 101.6, 101.2),
      config,
    });
    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.trailingArmed).toBe(true);
    expect(result.reason).toBe('trailing_active_hold');

    position = { ...position, ...result.nextPositionState } as OpenPosition;
    expect(position.trailingArmed).toBe(true);

    // Bar 4: price continues up, close at 102.5, high 102.8 → HOLD
    result = evaluateExit({
      position,
      market: makeMarket(102.5, 102.8, 102.0),
      config,
    });
    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.peakProfitPct).toBeGreaterThan(2.5);

    position = { ...position, ...result.nextPositionState } as OpenPosition;

    // Bar 5: price pulls back, close at 101.5
    // Peak was ~2.8%, current ~1.5%, giveback ~1.3
    // allowed = clamp(2.8 * 0.35, 0.4, 1.5) = ~0.98
    // giveback 1.3 >= 0.98 ✓, currentProfit 1.5 >= 0.4 ✓ → EXIT
    result = evaluateExit({
      position,
      market: makeMarket(101.5, 101.8, 101.3),
      config,
    });
    expect(result.action).toBe('EXIT_TRAILING_PROFIT');
    expect(result.diagnostics.currentProfitPct).toBeGreaterThan(0.4);
    expect(result.nextPositionState).toBeUndefined();
  });
});
