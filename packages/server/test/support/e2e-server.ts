import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config';
import { bootstrap } from '../../src/main';
import { createTestDatabase } from './harness';

// Serves the built web bundle against a throwaway database, dropped again on shutdown.
const database = await createTestDatabase();
const config = loadConfig({
  STOCKUP_DATABASE_URL: database.url,
  STOCKUP_PORT: process.env.STOCKUP_PORT,
  STOCKUP_EVIDENCE_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-e2e-')), 'evidence'),
  STOCKUP_WEB_DIR: process.env.STOCKUP_WEB_DIR,
});
const { app, close } = await bootstrap(config);
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`StockUp e2e server on ${server.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop(true);
    await close();
    await database.drop();
    process.exit(0);
  });
}
