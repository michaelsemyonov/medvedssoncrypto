# Runbook

## Local startup

1. Copy `.env.example` to `.env`.
2. Ensure MySQL is reachable at `DATABASE_URL`.
3. Run `pnpm install`.
4. Run `pnpm db:migrate`.
5. Start the API with `pnpm dev:api`.
6. Start the PWA with `pnpm dev:pwa`.

## Docker startup

- `docker compose up --build`

Services:

- API: `http://localhost:3000`
- PWA: `http://localhost:3001`
- Adminer: `http://localhost:8080`

## Health and diagnostics

- `GET /health`: service and runner state
- `GET /ready`: readiness probe
- `GET /metrics`: Prometheus metrics

Important metrics:

- candles processed
- duplicate candles skipped
- signal approvals/rejections
- simulated orders created
- open positions
- realized and unrealized PnL
- drawdown
- market-data latency
- DB write errors

## Operational notes

- V1 refuses to boot if `DRY_RUN` is not true.
- Web Push requires valid VAPID keys and HTTPS in production.
- Exchange/API interruptions are retried with backoff and the runner keeps polling.
- Restart safety depends on preserving MySQL state.
