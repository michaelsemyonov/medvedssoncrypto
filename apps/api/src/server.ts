import 'dotenv/config';

import { buildApp } from './app.ts';

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
    port: config.port
  });

  if (config.runnerAutostart) {
    void runner.start().catch((error) => {
      app.log.error({ err: error }, 'Runner autostart failed.');
    });
  }
};

void main();
