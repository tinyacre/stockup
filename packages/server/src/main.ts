import { mkdir } from 'node:fs/promises';
import { createApp } from './app';
import { createAuth } from './auth';
import { loadConfig, type Config } from './config';
import { connect, migrate } from './db';

export async function bootstrap(config: Config) {
  await mkdir(config.evidenceDir, { recursive: true });
  const { db, close } = connect(config.databaseUrl);
  await migrate(db);
  const auth = createAuth({ db, secret: config.authSecret, baseURL: config.baseUrl });
  return { app: createApp({ db, auth, webDir: config.webDir }), close };
}

if (import.meta.main) {
  const config = loadConfig(process.env);
  const { app } = await bootstrap(config);
  const server = Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`StockUp listening on ${server.url}`);
}
