import 'dotenv/config';

import { createDatabase } from '@medvedsson/db';
import { loadConfig } from '@medvedsson/shared';

const main = async () => {
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  await db.migrate();
  await db.close();
};

void main();
