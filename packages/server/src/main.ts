import { mkdir } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { anthropicRecognizer } from './anthropic-recognizer';
import { createApp } from './app';
import { createAuth, mcpAvailable } from './auth';
import { loadConfig, type Config } from './config';
import { connect, migrate } from './db';
import { localEvidenceStore } from './evidence-store';
import { smtpMailer, type Mailer } from './mailer';
import { openS3EvidenceStore } from './s3-evidence-store';
import { failInterruptedRecognitions } from './recognitions';
import type { ScreenshotRecognizer } from './recognizer';
import { cloudflareTurnstile, type TurnstileVerifier } from './turnstile';

// Recognitions give up after two minutes, so a slow call retries once at most and stops by then.
function configuredRecognizer({ apiKey, model }: NonNullable<Config['recognizer']>) {
  return anthropicRecognizer(new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 }), model);
}

async function openLocalEvidenceStore(dir: string) {
  await mkdir(dir, { recursive: true });
  return localEvidenceStore(dir);
}

// A recognizer, mailer or Turnstile verifier passed in takes the place of the one the config describes.
export async function bootstrap(
  config: Config,
  options: {
    recognizer?: ScreenshotRecognizer;
    fetchClientMetadataResource?: ClientMetadataResourceFetch;
    mailer?: Mailer;
    turnstile?: TurnstileVerifier;
  } = {},
) {
  const { fetchClientMetadataResource } = options;
  const recognizer = options.recognizer ?? (config.recognizer && configuredRecognizer(config.recognizer));
  const mailer = options.mailer ?? (config.smtp && smtpMailer(config.smtp));
  const turnstile = options.turnstile ?? (config.turnstile && cloudflareTurnstile(config.turnstile));
  const evidence = config.s3 ? await openS3EvidenceStore(config.s3) : await openLocalEvidenceStore(config.evidenceDir);
  const { db, close } = connect(config.databaseUrl);
  await migrate(db);
  await failInterruptedRecognitions(db);
  if (!mcpAvailable(config.baseUrl)) {
    console.warn(`MCP is disabled: STOCKUP_BASE_URL (${config.baseUrl}) must use HTTPS for MCP clients to connect.`);
  }
  const auth = createAuth({ db, secret: config.authSecret, baseURL: config.baseUrl, clientIpHeader: config.clientIpHeader, fetchClientMetadataResource });
  // Plugin init seeds the MCP resource row, so the database must stay open until it finishes.
  await auth.$context;
  const app = createApp({
    db,
    auth,
    evidence,
    recognizer,
    webDir: config.webDir,
    mailer,
    signupOpen: config.signup === 'open',
    turnstile,
    clientIpHeader: config.clientIpHeader,
  });
  return { app, close };
}

if (import.meta.main) {
  const config = loadConfig(process.env);
  const { app } = await bootstrap(config);
  const server = Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`StockUp listening on ${server.url}`);
}
