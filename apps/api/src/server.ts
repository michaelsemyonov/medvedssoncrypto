import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

import { buildApp } from './app.ts';

const loadEnvironment = () => {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(serverDir, '..');
  const repoDir = path.resolve(appDir, '..', '..');
  const candidates = [
    process.env.DOTENV_CONFIG_PATH,
    path.join(appDir, '.env'),
    path.join(repoDir, '.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loadDotenv({
        override: false,
        path: candidate,
      });
    }
  }
};

loadEnvironment();

const main = async () => {
  const { app, config, runner } = await buildApp();

  const close = async () => {
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void close();
  });

  process.on('SIGTERM', () => {
    void close();
  });

  await app.listen({
    host: '0.0.0.0',
    port: config.port,
  });

  if (config.runnerAutostart) {
    void runner.start().catch((error) => {
      app.log.error({ err: error }, 'Runner autostart failed.');
    });
  }
};

void main();
