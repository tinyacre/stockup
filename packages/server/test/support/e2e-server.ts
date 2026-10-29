import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config';
import { bootstrap } from '../../src/main';
import { fetchClaudeMetadata } from './claude-metadata';
import { fakeMailer } from './fake-mailer';
import { fakeRecognizerFactory } from './fake-recognizer';
import { createTestDatabase, testAuthSecret } from './harness';

// Serves the built web bundle against a throwaway database, dropped again on shutdown, with the fake
// screenshot recognizer standing in for the model and Claude's client metadata served locally. Signup is open
// and mail lands in an in-memory inbox, which tests read at GET /__e2e/mail?to=<email>, newest first.
const database = await createTestDatabase();
const config = loadConfig({
  STOCKUP_DATABASE_URL: database.url,
  STOCKUP_AUTH_SECRET: testAuthSecret,
  STOCKUP_BASE_URL: process.env.STOCKUP_BASE_URL,
  STOCKUP_PORT: process.env.STOCKUP_PORT,
  STOCKUP_EVIDENCE_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-e2e-')), 'evidence'),
  STOCKUP_WEB_DIR: process.env.STOCKUP_WEB_DIR,
  STOCKUP_SIGNUP: 'open',
  STOCKUP_SMTP_HOST: 'smtp.invalid',
  STOCKUP_SMTP_FROM: 'StockUp <noreply@stockup.invalid>',
  STOCKUP_RECOGNITION_PROVIDER: 'anthropic',
  STOCKUP_RECOGNITION_API_KEY: 'sk-ant-e2e',
});
const mailer = fakeMailer();
const { app, close } = await bootstrap(config, {
  recognizers: fakeRecognizerFactory(),
  fetchClientMetadataResource: fetchClaudeMetadata,
  mailer,
});
const server = Bun.serve({
  port: config.port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/__e2e/mail') return app.fetch(request);
    const to = url.searchParams.get('to')?.toLowerCase();
    return Response.json({ messages: mailer.messages.filter((m) => m.to === to).reverse() });
  },
});
console.log(`StockUp e2e server on ${server.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop(true);
    await close();
    await database.drop();
    process.exit(0);
  });
}
