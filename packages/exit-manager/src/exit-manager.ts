import type {
  ExitConfig,
  ExitDecision,
  ExitDiagnostics,
  MarketContext,
  OpenPosition,
} from './types.ts';

/**
 * Clamps a value between a minimum and maximum bound.
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Calculates the unrealized profit percentage for a LONG position.
 *
 * A LONG profits when the current price is above entry.
 */
export const calcLongProfitPct = (
  entryPrice: number,
  currentPrice: number
): number => (currentPrice / entryPrice - 1) * 100;

/**
 * Calculates the unrealized profit percentage for a SHORT position.
 *
 * A SHORT profits when the current price is below entry.
 */
export const calcShortProfitPct = (
  entryPrice: number,
  currentPrice: number
): number => (1 - currentPrice / entryPrice) * 100;

/**
 * Calculates the unrealized profit percentage based on position side.
 */
export const calcProfitPct = (
  side: OpenPosition['side'],
  entryPrice: number,
  currentPrice: number
): number =>
  side === 'LONG'
    ? calcLongProfitPct(entryPrice, currentPrice)
    : calcShortProfitPct(entryPrice, currentPrice);

/**
 * Returns the most favorable price seen so far for a given side,
 * comparing the previously recorded peak with the current candle's extremes.
 *
 * For LONG positions the best price is the highest high.
 * For SHORT positions the best price is the lowest low.
 */
export const updateMaxFavorablePrice = (
  side: OpenPosition['side'],
  previousMax: number,
  candleHigh: number,
  candleLow: number
): number =>
  side === 'LONG'
    ? Math.max(previousMax, candleHigh)
    : Math.min(previousMax, candleLow);

/**
 * Evaluates whether an open position should be held or exited.
 *
 * Exit priority (highest to lowest):
 *   1. EXIT_STOP          – hard stop-loss hit
 *   2. EXIT_TRAILING_PROFIT – trailing giveback threshold exceeded
 *   3. EXIT_SIGNAL_REVERSAL – signal engine requests reversal
 *   4. EXIT_TIME_STOP      – maximum bars in trade exceeded
 *   5. HOLD                – keep position open
 *
 * This function is pure – no side effects, no I/O, no logging.
 * All the information needed for diagnostics and tuning is returned
 * in the {@link ExitDiagnostics} payload.
 */
export const evaluateExit = (params: {
  position: OpenPosition;
  market: MarketContext;
  config: ExitConfig;
  signalExit?: boolean | undefined;
  hardStopHit?: boolean | undefined;
}): ExitDecision => {
  const { position, market, config, signalExit, hardStopHit } = params;
  const close = market.latestClosedCandle.close;
  const high = market.latestClosedCandle.high;
  const low = market.latestClosedCandle.low;

  // --- Profit calculations ------------------------------------------------

  const currentProfitPct = calcProfitPct(position.side, position.entryPrice, close);

  // Update the max favorable price using the candle extremes (not just close)
  const updatedMaxFavorablePrice = updateMaxFavorablePrice(
    position.side,
    position.maxFavorablePrice,
    high,
    low
  );

  // Peak profit considers both the stored peak and the best intra-candle move
  const peakFromPrice = calcProfitPct(
    position.side,
    position.entryPrice,
    updatedMaxFavorablePrice
  );
  const peakProfitPct = Math.max(position.maxFavorableProfitPct, peakFromPrice, currentProfitPct);

  // --- Trailing arm logic -------------------------------------------------

  let trailingArmed = position.trailingArmed;
  let trailingArmedAtProfitPct: number | null = position.trailingArmed
    ? (position.maxFavorableProfitPct >= config.trailing.activationProfitPct
        ? position.maxFavorableProfitPct
        : peakProfitPct)
    : null;

  if (
    config.trailing.enabled &&
    !trailingArmed &&
    peakProfitPct >= config.trailing.activationProfitPct
  ) {
    trailingArmed = true;
    trailingArmedAtProfitPct = peakProfitPct;
  }

  // --- Giveback calculations ----------------------------------------------

  const allowedGivebackPct = trailingArmed
    ? clamp(
        peakProfitPct * config.trailing.givebackRatio,
        config.trailing.givebackMinPct,
        config.trailing.givebackMaxPct
      )
    : null;

  const givebackPct = trailingArmed ? peakProfitPct - currentProfitPct : 0;

  // --- Build diagnostics --------------------------------------------------

  const barsHeld = position.barsHeld + 1;

  const diagnostics: ExitDiagnostics = {
    entryPrice: position.entryPrice,
    currentClose: close,
    currentProfitPct,
    peakProfitPct,
    givebackPct,
    allowedGivebackPct,
    trailingArmed,
    trailingArmedAtProfitPct,
    minLockedProfitPct: trailingArmed ? config.trailing.minLockedProfitPct : null,
    barsHeld,
    atrPct: market.atrPct,
  };

  // --- Exit priority evaluation -------------------------------------------

  // Priority 1: Hard stop
  if (hardStopHit) {
    return {
      action: 'EXIT_STOP',
      reason: 'hard_stop_hit',
      diagnostics,
    };
  }

  // Priority 2: Trailing profit exit
  if (
    trailingArmed &&
    allowedGivebackPct !== null &&
    givebackPct >= allowedGivebackPct &&
    currentProfitPct >= config.trailing.minLockedProfitPct
  ) {
    return {
      action: 'EXIT_TRAILING_PROFIT',
      reason: 'trailing_profit_giveback_exceeded',
      diagnostics,
    };
  }

  // Priority 3: Signal reversal
  if (config.allowSignalReversalExit && signalExit) {
    return {
      action: 'EXIT_SIGNAL_REVERSAL',
      reason: 'signal_reversal',
      diagnostics,
    };
  }

  // Priority 4: Time-based exit
  if (
    !trailingArmed &&
    typeof config.maxBarsInTrade === 'number' &&
    barsHeld >= config.maxBarsInTrade
  ) {
    return {
      action: 'EXIT_TIME_STOP',
      reason: 'max_bars_in_trade_reached',
      diagnostics,
    };
  }

  // Priority 5: Hold
  return {
    action: 'HOLD',
    reason: trailingArmed ? 'trailing_active_hold' : 'hold_no_exit_condition',
    diagnostics,
    nextPositionState: {
      trailingArmed,
      trailingArmedAt: trailingArmed && !position.trailingArmed
        ? market.latestClosedCandle.closeTime
        : position.trailingArmedAt,
      maxFavorablePrice: updatedMaxFavorablePrice,
      maxFavorableProfitPct: peakProfitPct,
      barsHeld,
    },
  };
};
