# Architecture

## Shape

MedvedssonCrypto is implemented as a modular monolith:

- `apps/api`: Fastify backend, health endpoints, admin and PWA APIs
- `apps/pwa`: Next.js PWA with installability and push subscription management
- `packages/shared`: domain types, config validation, symbol/time helpers
- `packages/strategy`: pure 96/5/72 formula engine
- `packages/execution`: pure risk checks, slippage, fill, and PnL logic
- `packages/db`: MySQL migrations and repositories
- `packages/market-data`: exchange adapters for Bybit and Binance REST OHLCV
- `packages/notifications`: Web Push delivery
- `packages/core`: runner orchestration and Prometheus metrics

## Candle pipeline

1. Runner polls active symbols from MySQL using each symbol row's exchange and timeframe settings.
2. Candles are normalized and optionally persisted into `market_candles`.
3. Any pending dry-run orders scheduled for the new candle open are filled first.
4. The strategy evaluates the newly closed candle with warm-up history.
5. `NO_SIGNAL` outcomes advance per-run symbol progress but are not stored in `signals`.
6. Actionable signals are written to `signals`, then risk checks approve or reject them into `risk_events`.
7. Approved actionable signals create `PENDING` simulated orders for the next candle open.
8. Equity snapshots are updated after processing.
9. Notifications are sent to enabled push subscribers for that event type.

## Restart safety

Restart safety is enforced through database state:

- `run_symbol_progress` tracks the latest processed candle per `(strategy_run_id, symbol_id)`
- `signals.idempotency_key` prevents duplicate actionable signal writes
- `simulated_orders(signal_id, intent)` prevents duplicate dry-run order creation
- open positions are constrained to one active position per `(strategy_run_id, symbol_id)`
- pending next-open orders are only fillable once because status transitions from `PENDING` to `FILLED`

## Future live mode path

The strategy package has no dependency on:

- exchanges
- persistence
- notifications
- execution transports

That separation is what makes a future live execution adapter feasible without rewriting the core formula.
