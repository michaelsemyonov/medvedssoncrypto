# Database Schema

## Core tables

- `strategy_runs`: strategy sessions and dry-run lifecycle
- `symbols`: tracked exchange symbols and active flags
- `market_candles`: optional persisted OHLCV for audit and replay
- `signals`: every decision outcome, including `NO_SIGNAL`
- `risk_events`: approval and rejection trail for each signal
- `positions`: dry-run open and closed positions
- `simulated_orders`: pending and filled virtual order journal
- `equity_snapshots`: equity curve and drawdown support
- `push_subscriptions`: PWA web-push subscribers

## Idempotency and safety constraints

- `symbols(exchange, symbol)` unique
- `market_candles(exchange, symbol, timeframe, close_time)` unique
- `signals(idempotency_key)` unique
- `simulated_orders(signal_id, intent)` unique
- partial unique index on `positions(strategy_run_id, symbol_id)` where status is `OPEN`

## Analytics supported now

- win rate
- average trade return
- realized PnL
- equity
- max drawdown
- open position count

The schema also preserves enough context for future rejection-reason analysis, signal quality review, and replay tooling.

## MySQL-specific note

MySQL does not support PostgreSQL-style partial unique indexes, so the one-open-position rule is enforced with the nullable `open_slot` unique column. Open positions store a deterministic slot key per `(strategy_run_id, symbol_id)`, while closed positions clear that slot.
