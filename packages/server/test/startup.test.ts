import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { loadConfig } from '../src/config';
import { bootstrap } from '../src/main';
import { createTestDatabase } from './support/harness';

describe('loadConfig', () => {
  test('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow('STOCKUP_DATABASE_URL');
  });

  test('applies defaults for optional settings', () => {
    expect(loadConfig({ STOCKUP_DATABASE_URL: 'postgres://x/y' })).toEqual({
      databaseUrl: 'postgres://x/y',
      port: 8080,
      evidenceDir: path.resolve('data/evidence'),
      webDir: undefined,
    });
  });

  test('reads every setting from the environment', () => {
    expect(
      loadConfig({
        STOCKUP_DATABASE_URL: 'postgres://x/y',
        STOCKUP_PORT: '3000',
        STOCKUP_EVIDENCE_DIR: '/srv/evidence',
        STOCKUP_WEB_DIR: '/srv/web',
      }),
    ).toEqual({
      databaseUrl: 'postgres://x/y',
      port: 3000,
      evidenceDir: '/srv/evidence',
      webDir: '/srv/web',
    });
  });

  test('treats a blank setting as unset', () => {
    expect(loadConfig({ STOCKUP_DATABASE_URL: 'postgres://x/y', STOCKUP_PORT: '' }).port).toBe(8080);
  });

  test('rejects a non-numeric port', () => {
    expect(() => loadConfig({ STOCKUP_DATABASE_URL: 'postgres://x/y', STOCKUP_PORT: 'abc' })).toThrow(
      'STOCKUP_PORT',
    );
  });
});

describe('bootstrap', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });

  async function emptyDatabaseUrl() {
    const database = await createTestDatabase();
    cleanups.push(database.drop);
    // Start from a database that has never seen a migration.
    const sql = postgres(database.url, { max: 1, onnotice: () => {} });
    await sql`drop schema if exists drizzle cascade`;
    await sql.end();
    return database.url;
  }

  test('migrates the database and creates the evidence directory before serving', async () => {
    const evidenceDir = path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence');
    const config = { databaseUrl: await emptyDatabaseUrl(), port: 0, evidenceDir, webDir: undefined };

    const first = await bootstrap(config);
    cleanups.push(first.close);
    expect(existsSync(evidenceDir)).toBe(true);
    expect((await first.app.request('/api/health')).status).toBe(200);

    // A restart against the same database (e.g. after swapping the image) is a no-op upgrade.
    const second = await bootstrap(config);
    cleanups.push(second.close);
    expect((await second.app.request('/api/health')).status).toBe(200);
  });
});
