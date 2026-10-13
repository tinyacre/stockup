import path from 'node:path';

export interface Config {
  databaseUrl: string;
  port: number;
  evidenceDir: string;
  webDir: string | undefined;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.STOCKUP_DATABASE_URL;
  if (!databaseUrl) throw new Error('STOCKUP_DATABASE_URL is required');

  const port = Number(env.STOCKUP_PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`STOCKUP_PORT must be a port number, got "${env.STOCKUP_PORT}"`);
  }

  return {
    databaseUrl,
    port,
    evidenceDir: path.resolve(env.STOCKUP_EVIDENCE_DIR || 'data/evidence'),
    webDir: env.STOCKUP_WEB_DIR ? path.resolve(env.STOCKUP_WEB_DIR) : undefined,
  };
}
