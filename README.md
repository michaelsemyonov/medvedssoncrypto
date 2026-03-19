# MedvedssonCrypto

Backend-first crypto dry-run trading platform built as a monorepo. It monitors configured `*/USDT` pairs on the `5m` timeframe, applies the exact `96/5/72` momentum formula, persists every decision trail in MySQL, simulates next-open fills, exposes health and metrics endpoints, and ships a Next.js PWA for signal visibility and web-push delivery.

## What V1 does

- Watches configured spot symbols such as `BTC/USDT`, `ETH/USDT`, and `SOL/USDT`
- Processes newly closed `5m` candles only once, even across restarts
- Uses the exact strategy formula:
  - `r_t = (P_t / P_{t-1}) - 1`
  - `B_t = (1/96) * sum_{i=1}^{96} |r_{t-i}|`
  - `LONG if r_t > 5 * B_t`
  - `SHORT if r_t < -5 * B_t`
  - Exit signal after `72` bars
- Persists signals, risk decisions, orders, positions, equity snapshots, and push subscriptions in MySQL
- Fills simulated orders at the next candle open with configurable slippage and fees
- Sends Web Push notifications to a PWA
- Exposes `/health`, `/ready`, `/metrics`, `/dashboard`, `/signals`, `/positions`, `/trades`, and admin run/symbol endpoints

## Repo layout

```text
crypto-dryrun-platform/
├─ apps/
│  ├─ api/
│  └─ pwa/
├─ packages/
│  ├─ core/
│  ├─ strategy/
│  ├─ execution/
│  ├─ db/
│  ├─ market-data/
│  ├─ notifications/
│  └─ shared/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ docs/
├─ scripts/
├─ docker-compose.yml
├─ Dockerfile
├─ .env.example
├─ package.json
├─ pnpm-workspace.yaml
└─ Makefile
```

## Quick start

Runtime requirement: Node `22.x` and pnpm `10.x`.

1. Create `.env` from `.env.example`.
2. Start MySQL locally or with Docker Compose.
3. Install dependencies:

```bash
pnpm install
```

4. Run migrations:

```bash
pnpm db:migrate
```

5. Start the backend:

```bash
pnpm dev:api
```

6. Start the PWA:

```bash
pnpm dev:pwa
```

The API runs on `http://localhost:3000` and the PWA on `http://localhost:3001`.

## Environment

Use `.env` only for secrets and runtime configuration. `.env.example` contains the full supported baseline, including:

- exchange selection: `EXCHANGE=bybit|binance`
- timeframe: `TIMEFRAME=5m`
- tracked symbols: `SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT`
- dry-run enforcement: `DRY_RUN=true`
- strategy parameters: `SIGNAL_N=96`, `SIGNAL_K=5`, `SIGNAL_H_BARS=72`
- simulation settings: fees, slippage, fixed USDT sizing
- risk controls: `MAX_OPEN_POSITIONS`, `COOLDOWN_BARS`, `MAX_DAILY_DRAWDOWN_PCT`, `MAX_CONSECUTIVE_LOSSES`
- PWA auth: `ADMIN_PASSWORD`, `SESSION_SECRET`, `SESSION_TTL_HOURS`
- push configuration: `WEB_PUSH_VAPID_*`

## Commands

- `pnpm dev` runs API and PWA together
- `pnpm dev:api` runs the Fastify backend with Node 22 type stripping
- `pnpm dev:pwa` runs the Next.js PWA
- `pnpm db:migrate` applies MySQL migrations
- `pnpm typecheck` runs TypeScript checks
- `pnpm test` runs unit, integration, and e2e-oriented tests
- `docker compose up --build` starts MySQL, API, PWA, and Adminer

## API surface

- `GET /health`
- `GET /ready`
- `GET /metrics`
- `GET /runs`
- `POST /runs/start`
- `POST /runs/stop`
- `GET /symbols`
- `PUT /symbols`
- `GET /signals/recent`
- `GET /positions/open`
- `GET /trades/recent`
- `GET /stats/summary`
- `POST /push/subscribe`
- `POST /push/unsubscribe`
- `GET /dashboard`
- `GET /signals`
- `GET /positions`
- `GET /trades`
- `GET /settings`

## Testing status

The repository includes:

- unit tests for formula, exit timing, risk guards, slippage, and PnL
- integration-style coverage for repository idempotency behavior
- e2e-style runner coverage for signal generation, next-open entry fill, notification emission, and restart safety

## Notes

- V1 hard-enforces `DRY_RUN=true` at startup.
- The PWA now uses a single shared admin password and a signed session cookie.
- The execution adapter is already isolated so a future live-trading adapter can replace the dry-run implementation without rewriting the strategy core.
- HTTPS is required in production for Web Push behavior in the PWA.
