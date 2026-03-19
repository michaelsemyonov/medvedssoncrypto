import type { RiskDecision, RiskInput } from '@medvedsson/shared';
import { SIGNAL_TYPES } from '@medvedsson/shared';

const reject = (input: RiskInput, rejectionCode: string, rejectionReason: string): RiskDecision => ({
  approved: false,
  rejectionCode,
  rejectionReason,
  snapshot: {
    openPositionsCount: input.openPositionsCount,
    cooldownRemainingBars: input.cooldownRemainingBars,
    currentDrawdownPct: input.currentDrawdownPct,
    consecutiveLosses: input.consecutiveLosses,
    signalType: input.signal.signalType
  }
});

export const evaluateRisk = (input: RiskInput): RiskDecision => {
  if (input.signal.signalType === SIGNAL_TYPES.NO_SIGNAL) {
    return reject(input, 'NO_SIGNAL', input.signal.reason);
  }

  if (!input.symbolEnabled) {
    return reject(input, 'SYMBOL_DISABLED', 'Symbol is disabled.');
  }

  if (!input.enoughHistory) {
    return reject(input, 'INSUFFICIENT_HISTORY', 'Not enough history for the configured warm-up.');
  }

  if (input.signal.signalType === SIGNAL_TYPES.SHORT_ENTRY && !input.allowShort) {
    return reject(input, 'SHORT_DISABLED', 'Short entries are disabled.');
  }

  if (
    (input.signal.signalType === SIGNAL_TYPES.LONG_EXIT ||
      input.signal.signalType === SIGNAL_TYPES.SHORT_EXIT) &&
    !input.openPosition
  ) {
    return reject(input, 'NO_OPEN_POSITION', 'Exit requested but there is no open position.');
  }

  if (
    (input.signal.signalType === SIGNAL_TYPES.LONG_ENTRY ||
      input.signal.signalType === SIGNAL_TYPES.SHORT_ENTRY) &&
    input.openPosition
  ) {
    return reject(input, 'POSITION_ALREADY_OPEN', 'Only one position per symbol is allowed in V1.');
  }

  if (
    (input.signal.signalType === SIGNAL_TYPES.LONG_ENTRY ||
      input.signal.signalType === SIGNAL_TYPES.SHORT_ENTRY) &&
    input.openPositionsCount >= input.maxOpenPositions
  ) {
    return reject(
      input,
      'MAX_OPEN_POSITIONS',
      `Max open positions reached (${input.maxOpenPositions}).`
    );
  }

  if (input.cooldownRemainingBars > 0) {
    return reject(
      input,
      'COOLDOWN',
      `Cooldown active for ${input.cooldownRemainingBars} more bars after the previous exit.`
    );
  }

  if (input.currentDrawdownPct >= input.maxDailyDrawdownPct) {
    return reject(
      input,
      'DAILY_DRAWDOWN_GUARD',
      `Daily drawdown guard breached (${input.currentDrawdownPct.toFixed(2)}%).`
    );
  }

  if (input.consecutiveLosses >= input.maxConsecutiveLosses) {
    return reject(
      input,
      'CONSECUTIVE_LOSSES_GUARD',
      `Consecutive loss guard breached (${input.consecutiveLosses}).`
    );
  }

  return {
    approved: true,
    rejectionCode: null,
    rejectionReason: null,
    snapshot: {
      openPositionsCount: input.openPositionsCount,
      cooldownRemainingBars: input.cooldownRemainingBars,
      currentDrawdownPct: input.currentDrawdownPct,
      consecutiveLosses: input.consecutiveLosses,
      signalType: input.signal.signalType
    }
  };
};
