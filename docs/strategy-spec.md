# Strategy Spec

## Exact formula

Definitions:

- `r_t = (P_t / P_{t-1}) - 1`
- `B_t = (1/96) * sum_{i=1}^{96} |r_{t-i}|`

Where:

- `P_t` is the current candle close
- `P_{t-1}` is the previous candle close
- `B_t` is the mean absolute 5-minute return over the previous 96 bars

## Entry rules

- `LONG_ENTRY` when `r_t > 5 * B_t`
- `SHORT_ENTRY` when `r_t < -5 * B_t`
- otherwise `NO_SIGNAL`

## Exit rule

- exit signal after `72` bars
- on `5m`, that is 6 hours

## Parameters

- `N = 96`
- `k = 5`
- `H = 72`
- `timeframe = 5m`

## Implementation notes

- entries and exits are converted into next-open simulated orders
- signals persist formula inputs in JSON:
  - `r_t`
  - `B_t`
  - `N`
  - `k`
  - `H`
  - threshold comparison result
- open positions suppress new entry signals until the 72-bar exit rule triggers

## Caveat

The previously reported in-sample result came from the same dataset used for tuning. This implementation keeps the strategy core replay-friendly so later walk-forward and out-of-sample validation can be added cleanly.
