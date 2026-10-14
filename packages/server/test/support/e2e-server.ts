import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config';
import { bootstrap } from '../../src/main';
import { fetchClaudeMetadata } from './claude-metadata';
import { fakeRecognizer } from './fake-recognizer';
import { createTestDatabase, testAuthSecret } from './harness';

// Serves the built web bundle against a throwaway database, dropped again on shutdown, with the fake
// screenshot recognizer standing in for the model and Claude's client metadata served locally.
const database = await createTestDatabase();
const config = loadConfig({
  STOCKUP_DATABASE_URL: database.url,
  STOCKUP_AUTH_SECRET: testAuthSecret,
  STOCKUP_BASE_URL: process.env.STOCKUP_BASE_URL,
  STOCKUP_PORT: process.env.STOCKUP_PORT,
  STOCKUP_EVIDENCE_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-e2e-')), 'evidence'),
  STOCKUP_WEB_DIR: process.env.STOCKUP_WEB_DIR,
});
const { app, close } = await bootstrap(config, {
  recognizer: fakeRecognizer(),
  fetchClientMetadataResource: fetchClaudeMetadata,
});
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
