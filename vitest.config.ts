import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@medvedsson/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@medvedsson/strategy': fileURLToPath(new URL('./packages/strategy/src/index.ts', import.meta.url)),
      '@medvedsson/execution': fileURLToPath(new URL('./packages/execution/src/index.ts', import.meta.url)),
      '@medvedsson/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@medvedsson/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@medvedsson/market-data': fileURLToPath(new URL('./packages/market-data/src/index.ts', import.meta.url)),
      '@medvedsson/notifications': fileURLToPath(new URL('./packages/notifications/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts']
  }
});
