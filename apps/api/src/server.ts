import 'dotenv/config';

import { buildApp } from './app.ts';

const main = async () => {
  const { app, config } = await buildApp();

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
};

void main();
