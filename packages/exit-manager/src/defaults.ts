import type { TrailingProfitConfig, ExitConfig } from './types.ts';

export const TRAILING_PROFILES = {
  CONSERVATIVE: {
    enabled: true,
    activationProfitPct: 1.8,
    givebackRatio: 0.45,
    givebackMinPct: 0.6,
    givebackMaxPct: 2.0,
    minLockedProfitPct: 0.5,
  },
  BALANCED: {
    enabled: true,
    activationProfitPct: 1.2,
    givebackRatio: 0.35,
    givebackMinPct: 0.4,
    givebackMaxPct: 1.5,
    minLockedProfitPct: 0.4,
  },
  AGGRESSIVE: {
    enabled: true,
    activationProfitPct: 0.8,
    givebackRatio: 0.25,
    givebackMinPct: 0.25,
    givebackMaxPct: 1.0,
    minLockedProfitPct: 0.25,
  },
} as const satisfies Record<string, TrailingProfitConfig>;

export const DEFAULT_TRAILING_CONFIG: TrailingProfitConfig =
  TRAILING_PROFILES.BALANCED;

export const DEFAULT_EXIT_CONFIG: ExitConfig = {
  trailing: DEFAULT_TRAILING_CONFIG,
};
