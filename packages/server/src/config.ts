import path from 'node:path';

export interface Config {
  databaseUrl: string;
  authSecret: string;
  baseUrl: string;
  port: number;
  evidenceDir: string;
  webDir: string | undefined;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.STOCKUP_DATABASE_URL;
  if (!databaseUrl) throw new Error('STOCKUP_DATABASE_URL is required');

  const authSecret = env.STOCKUP_AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    throw new Error('STOCKUP_AUTH_SECRET is required and must be at least 32 characters');
  }

  // The issuer of OAuth tokens and the identifier of the MCP resource, so it cannot be derived per request.
  const baseUrl = env.STOCKUP_BASE_URL;
  if (!baseUrl || !URL.canParse(baseUrl)) {
    throw new Error('STOCKUP_BASE_URL is required and must be the public URL members open, e.g. https://stockup.example.com');
  }

  const port = Number(env.STOCKUP_PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`STOCKUP_PORT must be a port number, got "${env.STOCKUP_PORT}"`);
  }

  return {
    databaseUrl,
    authSecret,
    baseUrl,
    port,
    evidenceDir: path.resolve(env.STOCKUP_EVIDENCE_DIR || 'data/evidence'),
    webDir: env.STOCKUP_WEB_DIR ? path.resolve(env.STOCKUP_WEB_DIR) : undefined,
  };
}
