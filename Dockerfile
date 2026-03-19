FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json vitest.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/pwa/package.json apps/pwa/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/strategy/package.json packages/strategy/package.json
COPY packages/execution/package.json packages/execution/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/market-data/package.json packages/market-data/package.json
COPY packages/notifications/package.json packages/notifications/package.json

RUN pnpm install --frozen-lockfile

COPY . .

FROM base AS api
ENV NODE_ENV=production
CMD ["pnpm", "start:api"]

FROM base AS pwa
ENV NODE_ENV=production
RUN pnpm --filter @medvedsson/pwa build
CMD ["pnpm", "--filter", "@medvedsson/pwa", "start"]
