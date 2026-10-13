import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { bootstrap } from '../src/main';
import { createTestDatabase, testAuthSecret } from './support/harness';

const required = { STOCKUP_DATABASE_URL: 'postgres://x/y', STOCKUP_AUTH_SECRET: testAuthSecret };

describe('loadConfig', () => {
  test('requires a database URL', () => {
    expect(() => loadConfig({ STOCKUP_AUTH_SECRET: testAuthSecret })).toThrow('STOCKUP_DATABASE_URL');
  });

  test('requires a long enough auth secret', () => {
    expect(() => loadConfig({ STOCKUP_DATABASE_URL: 'postgres://x/y' })).toThrow('STOCKUP_AUTH_SECRET');
    expect(() => loadConfig({ ...required, STOCKUP_AUTH_SECRET: 'too-short' })).toThrow('STOCKUP_AUTH_SECRET');
  });

  test('applies defaults for optional settings', () => {
    expect(loadConfig(required)).toEqual({
      databaseUrl: 'postgres://x/y',
      authSecret: testAuthSecret,
      baseUrl: undefined,
      port: 8080,
      evidenceDir: path.resolve('data/evidence'),
      webDir: undefined,
    });
  });

  test('reads every setting from the environment', () => {
    expect(
      loadConfig({
        ...required,
        STOCKUP_BASE_URL: 'https://stockup.example.com',
        STOCKUP_PORT: '3000',
        STOCKUP_EVIDENCE_DIR: '/srv/evidence',
        STOCKUP_WEB_DIR: '/srv/web',
      }),
    ).toEqual({
      databaseUrl: 'postgres://x/y',
      authSecret: testAuthSecret,
      baseUrl: 'https://stockup.example.com',
      port: 3000,
      evidenceDir: '/srv/evidence',
      webDir: '/srv/web',
    });
  });

  test('treats a blank setting as unset', () => {
    expect(loadConfig({ ...required, STOCKUP_PORT: '' }).port).toBe(8080);
  });

  test('rejects a non-numeric port', () => {
    expect(() => loadConfig({ ...required, STOCKUP_PORT: 'abc' })).toThrow(
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
    const database = await createTestDatabase({ migrated: false });
    cleanups.push(database.drop);
    return database.url;
  }

  test('migrates the database and creates the evidence directory before serving', async () => {
    const evidenceDir = path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence');
    const config = {
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: undefined,
      port: 0,
      evidenceDir,
      webDir: undefined,
    };

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
