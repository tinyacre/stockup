import path from 'node:path';

export interface Config {
  databaseUrl: string;
  authSecret: string;
  baseUrl: string | undefined;
  port: number;
  evidenceDir: string;
  webDir: string | undefined;
  // Screenshot recognition is unavailable without an API key.
  recognizer: { apiKey: string; model: string } | undefined;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.STOCKUP_DATABASE_URL;
  if (!databaseUrl) throw new Error('STOCKUP_DATABASE_URL is required');

  const authSecret = env.STOCKUP_AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    throw new Error('STOCKUP_AUTH_SECRET is required and must be at least 32 characters');
  }

  const port = Number(env.STOCKUP_PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`STOCKUP_PORT must be a port number, got "${env.STOCKUP_PORT}"`);
  }

  return {
    databaseUrl,
    authSecret,
    baseUrl: env.STOCKUP_BASE_URL || undefined,
    port,
    evidenceDir: path.resolve(env.STOCKUP_EVIDENCE_DIR || 'data/evidence'),
    webDir: env.STOCKUP_WEB_DIR ? path.resolve(env.STOCKUP_WEB_DIR) : undefined,
    recognizer: env.STOCKUP_ANTHROPIC_API_KEY
      ? { apiKey: env.STOCKUP_ANTHROPIC_API_KEY, model: env.STOCKUP_ANTHROPIC_MODEL || 'claude-haiku-5-5' }
      : undefined,
  };
}
