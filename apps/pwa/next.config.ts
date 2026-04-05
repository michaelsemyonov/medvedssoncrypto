import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(configDir, '..', '..');

for (const candidate of [
  path.join(configDir, '.env'),
  path.join(repoDir, '.env'),
]) {
  if (existsSync(candidate)) {
    loadDotenv({
      override: false,
      path: candidate,
    });
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@medvedsson/shared'],
  allowedDevOrigins: ['http://0.0.0.0:3001'],
};

export default nextConfig;
