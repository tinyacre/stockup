import { mkdir } from 'node:fs/promises';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { createApp } from './app';
import { createAuth, mcpAvailable } from './auth';
import { loadConfig, type Config } from './config';
import { connect, migrate } from './db';
import { localEvidenceStore } from './evidence-store';
import { smtpMailer, type Mailer } from './mailer';
import { openS3EvidenceStore } from './s3-evidence-store';
import { failInterruptedRecognitions } from './recognitions';
import type { RecognizerFactory } from './recognizer';
import { cloudflareTurnstile, type TurnstileVerifier } from './turnstile';

async function openLocalEvidenceStore(dir: string) {
  await mkdir(dir, { recursive: true });
  return localEvidenceStore(dir);
}

// A recognizer factory passed in takes the place of the real providers, and a mailer or Turnstile verifier the
// place of the one the config describes.
export async function bootstrap(
  config: Config,
  options: {
    recognizers?: RecognizerFactory;
    fetchClientMetadataResource?: ClientMetadataResourceFetch;
    mailer?: Mailer;
    turnstile?: TurnstileVerifier;
  } = {},
) {
  const { recognizers, fetchClientMetadataResource } = options;
  const mailer = options.mailer ?? (config.smtp && smtpMailer(config.smtp));
  const turnstile = options.turnstile ?? (config.turnstile && cloudflareTurnstile(config.turnstile));
  const evidence = config.s3 ? await openS3EvidenceStore(config.s3) : await openLocalEvidenceStore(config.evidenceDir);
  const { db, close } = connect(config.databaseUrl);
  await migrate(db);
  await failInterruptedRecognitions(db);
  if (!mcpAvailable(config.baseUrl)) {
    console.warn(`MCP is disabled: STOCKUP_BASE_URL (${config.baseUrl}) must use HTTPS for MCP clients to connect.`);
  }
  const auth = createAuth({
    db,
    secret: config.authSecret,
    baseURL: config.baseUrl,
    clientIpHeader: config.clientIpHeader,
    fetchClientMetadataResource,
  });
  // Plugin init seeds the MCP resource row, so the database must stay open until it finishes.
  await auth.$context;
  const app = createApp({
    db,
    auth,
    evidence,
    recognizers,
    instanceRecognition: config.recognition,
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
