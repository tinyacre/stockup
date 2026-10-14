import { mkdir } from 'node:fs/promises';
import { createApp } from './app';
import { createAuth } from './auth';
import { loadConfig, type Config } from './config';
import { connect, migrate } from './db';
import { localEvidenceStore } from './evidence-store';
import { failInterruptedRecognitions } from './recognitions';
import type { ScreenshotRecognizer } from './recognizer';

// The screenshot recognizer stays unset until a real one is configured, which leaves recognition unavailable.
export async function bootstrap(config: Config, { recognizer }: { recognizer?: ScreenshotRecognizer } = {}) {
  await mkdir(config.evidenceDir, { recursive: true });
  const { db, close } = connect(config.databaseUrl);
  await migrate(db);
  await failInterruptedRecognitions(db);
  const auth = createAuth({ db, secret: config.authSecret, baseURL: config.baseUrl });
  const evidence = localEvidenceStore(config.evidenceDir);
  return { app: createApp({ db, auth, evidence, recognizer, webDir: config.webDir }), close };
}

if (import.meta.main) {
  const config = loadConfig(process.env);
  const { app } = await bootstrap(config);
  const server = Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`StockUp listening on ${server.url}`);
}
