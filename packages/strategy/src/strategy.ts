import type { Candle, OpenPositionContext, StrategyParams, StrategySignal } from '@medvedsson/shared';
import { SIGNAL_TYPES, timeframeToMs } from '@medvedsson/shared';

export const computeReturn = (currentClose: number, previousClose: number): number => {
  if (previousClose === 0) {
    throw new Error('Previous close cannot be zero.');
  }

  return currentClose / previousClose - 1;
};

export const computeBaselineMagnitude = (returns: number[], n: number): number => {
  if (returns.length < n) {
    throw new Error(`Expected at least ${n} returns to compute baseline.`);
  }

  const window = returns.slice(-n);
  const total = window.reduce((sum, value) => sum + Math.abs(value), 0);
  return total / n;
};

export const requiredCandles = (params: StrategyParams): number => params.n + 2;

export const computeBarsHeld = (
  openPosition: OpenPositionContext | null,
  candleCloseTime: string,
  timeframe: StrategyParams['timeframe']
): number => {
  if (!openPosition) {
    return 0;
  }

  const diffMs = new Date(candleCloseTime).getTime() - new Date(openPosition.entryTime).getTime();
  return Math.max(0, Math.floor(diffMs / timeframeToMs(timeframe)));
};

const buildNoSignal = (
  candleCloseTime: string,
  params: StrategyParams,
  reason: string,
  formula: Partial<StrategySignal['formulaInputs']> = {},
  features: Record<string, unknown> = {}
): StrategySignal => ({
  signalType: SIGNAL_TYPES.NO_SIGNAL,
  candleCloseTime,
  signalStrength: null,
  formulaInputs: {
    r_t: formula.r_t ?? null,
    B_t: formula.B_t ?? null,
    N: params.n,
    k: params.k,
    H: params.hBars,
    threshold: formula.threshold ?? null,
    comparison: formula.comparison ?? 'NONE'
  },
  indicators: {
    return: formula.r_t ?? null,
    baselineMoveMagnitude: formula.B_t ?? null
  },
  features,
  reason
});

export const evaluateMomentumStrategy = (
  candles: Candle[],
  params: StrategyParams,
  openPosition: OpenPositionContext | null
): StrategySignal => {
  if (candles.length === 0) {
    throw new Error('Expected candles to evaluate strategy.');
  }

  const latest = candles.at(-1);

  if (!latest) {
    throw new Error('Missing latest candle.');
  }

  const barsHeld = computeBarsHeld(openPosition, latest.closeTime, params.timeframe);

  if (openPosition && barsHeld >= params.hBars) {
    const signalType =
      openPosition.side === 'LONG' ? SIGNAL_TYPES.LONG_EXIT : SIGNAL_TYPES.SHORT_EXIT;

    return {
      signalType,
      candleCloseTime: latest.closeTime,
      signalStrength: 1,
      formulaInputs: {
        r_t: null,
        B_t: null,
        N: params.n,
        k: params.k,
        H: params.hBars,
        threshold: null,
        comparison: 'EXIT'
      },
      indicators: {
        return: null,
        baselineMoveMagnitude: null,
        barsHeld
      },
      features: {
        barsHeld,
        exitAfterBars: params.hBars
      },
      reason: `Exit after ${params.hBars} bars (${barsHeld} bars held).`
    };
  }

  if (candles.length < requiredCandles(params)) {
    return buildNoSignal(latest.closeTime, params, 'Not enough history for strategy warm-up.', {}, {
      candlesAvailable: candles.length,
      candlesRequired: requiredCandles(params)
    });
  }

  const closes = candles.map((candle) => candle.close);
  const returns: number[] = [];

  for (let index = 1; index < closes.length; index += 1) {
    returns.push(computeReturn(closes[index]!, closes[index - 1]!));
  }

  const r_t = returns.at(-1)!;
  const baselineReturns = returns.slice(-(params.n + 1), -1);
  const B_t = computeBaselineMagnitude(baselineReturns, params.n);
  const threshold = params.k * B_t;
  const strength = threshold === 0 ? null : Math.abs(r_t) / threshold;

  if (openPosition) {
    return buildNoSignal(
      latest.closeTime,
      params,
      'Position already open; waiting for exit condition.',
      { r_t, B_t, threshold, comparison: 'NONE' },
      { barsHeld, openPositionSide: openPosition.side }
    );
  }

  if (r_t > threshold) {
    return {
      signalType: SIGNAL_TYPES.LONG_ENTRY,
      candleCloseTime: latest.closeTime,
      signalStrength: strength,
      formulaInputs: {
        r_t,
        B_t,
        N: params.n,
        k: params.k,
        H: params.hBars,
        threshold,
        comparison: 'LONG'
      },
      indicators: {
        return: r_t,
        baselineMoveMagnitude: B_t
      },
      features: {
        thresholdMultiple: threshold === 0 ? null : r_t / B_t
      },
      reason: `LONG because r_t (${r_t.toFixed(6)}) exceeded ${params.k} x B_t (${B_t.toFixed(6)}).`
    };
  }

  if (r_t < -threshold) {
    return {
      signalType: SIGNAL_TYPES.SHORT_ENTRY,
      candleCloseTime: latest.closeTime,
      signalStrength: strength,
      formulaInputs: {
        r_t,
        B_t,
        N: params.n,
        k: params.k,
        H: params.hBars,
        threshold,
        comparison: 'SHORT'
      },
      indicators: {
        return: r_t,
        baselineMoveMagnitude: B_t
      },
      features: {
        thresholdMultiple: threshold === 0 ? null : Math.abs(r_t) / B_t
      },
      reason: `SHORT because r_t (${r_t.toFixed(6)}) was below -${params.k} x B_t (${B_t.toFixed(6)}).`
    };
  }

  return buildNoSignal(
    latest.closeTime,
    params,
    'Return remained inside the entry threshold.',
    { r_t, B_t, threshold, comparison: 'NONE' }
  );
};
