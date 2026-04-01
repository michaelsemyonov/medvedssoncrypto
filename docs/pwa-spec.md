# PWA Spec

## Purpose

The PWA is a monitoring client, not a trading terminal.

It provides:

- installable shell
- single-password admin login with signed session cookie
- push subscription management
- dashboard summary
- recent signals feed
- open positions list
- simulated trades history

## Screens

- `Dashboard`: active symbols, latest signal by symbol, runner status, stats
- `Signals`: recent signal rows with approval/rejection state and formula values
- `Positions`: open dry-run positions with unrealized PnL
- `Trades`: completed simulated trades and realized PnL
- `Settings`: subscribe/unsubscribe to web push notifications

## Push flow

1. Browser registers `/sw.js`.
2. User grants notification permission.
3. Browser creates a Push API subscription with the backend VAPID public key.
4. Subscription is stored in `push_subscriptions`.
5. Approved entries, exits, and configured error events fan out through Web Push.

## Non-goals in V1

- charting suite
- portfolio optimization UI
- live order entry
- advanced auth or multi-user controls
