import type { Candle, PositionSide } from '@medvedsson/shared';

export type OpenPosition = {
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  quantity: number;
  entryTime: string;
  entryCandleCloseTime: string;
  barsHeld: number;

  trailingArmed: boolean;
  trailingArmedAt?: string | undefined;

  maxFavorablePrice: number;
  maxFavorableProfitPct: number;
};

export type MarketContext = {
  candles: Candle[];
  latestClosedCandle: Candle;
  atrPct?: number | undefined;
};

export type TrailingProfitConfig = {
  enabled: boolean;
  activationProfitPct: number;
  givebackRatio: number;
  givebackMinPct: number;
  givebackMaxPct: number;
  minLockedProfitPct: number;
};

export type ExitConfig = {
  trailing: TrailingProfitConfig;
  maxBarsInTrade?: number | undefined;
  allowSignalReversalExit?: boolean | undefined;
};

export type ExitDiagnostics = {
  entryPrice: number;
  currentClose: number;
  currentProfitPct: number;
  peakProfitPct: number;
  givebackPct: number;
  allowedGivebackPct: number | null;
  trailingArmed: boolean;
  trailingArmedAtProfitPct: number | null;
  minLockedProfitPct: number | null;
  barsHeld: number;
  atrPct?: number | undefined;
};

export type ExitAction =
  | 'HOLD'
  | 'EXIT_TRAILING_PROFIT'
  | 'EXIT_STOP'
  | 'EXIT_SIGNAL_REVERSAL'
  | 'EXIT_TIME_STOP';

export type ExitDecision = {
  action: ExitAction;
  reason: string;
  diagnostics: ExitDiagnostics;
  nextPositionState?: Partial<OpenPosition> | undefined;
};
