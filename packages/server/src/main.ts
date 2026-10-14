import { mkdir } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicRecognizer } from './anthropic-recognizer';
import { createApp } from './app';
import { createAuth } from './auth';
import { loadConfig, type Config } from './config';
import { connect, migrate } from './db';
import { localEvidenceStore } from './evidence-store';
import { failInterruptedRecognitions } from './recognitions';
import type { ScreenshotRecognizer } from './recognizer';

// Recognitions give up after two minutes, so a slow call retries once at most and stops by then.
function configuredRecognizer({ apiKey, model }: NonNullable<Config['recognizer']>) {
  return anthropicRecognizer(new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 }), model);
}

// A recognizer passed in takes the place of the one the config describes.
export async function bootstrap(config: Config, options: { recognizer?: ScreenshotRecognizer } = {}) {
  const recognizer = options.recognizer ?? (config.recognizer && configuredRecognizer(config.recognizer));
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
