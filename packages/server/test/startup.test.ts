import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { bootstrap } from '../src/main';
import { createTestDatabase, jsonRequest, sessionCookie, testAuthSecret } from './support/harness';

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
      recognizer: undefined,
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
        STOCKUP_ANTHROPIC_API_KEY: 'sk-ant-test',
        STOCKUP_ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      }),
    ).toEqual({
      databaseUrl: 'postgres://x/y',
      authSecret: testAuthSecret,
      baseUrl: 'https://stockup.example.com',
      port: 3000,
      evidenceDir: '/srv/evidence',
      webDir: '/srv/web',
      recognizer: { apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5' },
    });
  });

  test('recognizes screenshots with Claude Haiku 5.5 unless another model is set', () => {
    expect(loadConfig({ ...required, STOCKUP_ANTHROPIC_API_KEY: 'sk-ant-test' }).recognizer).toEqual({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-5-5',
    });
  });

  test('leaves recognition unconfigured without an API key', () => {
    expect(loadConfig({ ...required, STOCKUP_ANTHROPIC_MODEL: 'claude-sonnet-5-5' }).recognizer).toBeUndefined();
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
      recognizer: undefined,
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

  test('makes recognition available once an Anthropic API key is configured', async () => {
    const config = {
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: undefined,
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
      recognizer: undefined,
    };
    const without = await bootstrap(config);
    cleanups.push(without.close);
    const configured = await bootstrap({ ...config, recognizer: { apiKey: 'sk-ant-test', model: 'claude-haiku-5-5' } });
    cleanups.push(configured.close);

    const username = `member_${crypto.randomUUID().slice(0, 8)}`;
    const password = 'password-recognizer';
    await without.app.request(
      '/api/setup',
      jsonRequest('POST', { householdName: 'Home', username, password, name: 'Member' }),
    );
    const signedIn = await without.app.request('/api/auth/sign-in/username', jsonRequest('POST', { username, password }));
    const cookie = sessionCookie(signedIn);

    expect(await (await without.app.request('/api/recognizer', { headers: { cookie } })).json()).toEqual({
      available: false,
    });
    expect(await (await configured.app.request('/api/recognizer', { headers: { cookie } })).json()).toEqual({
      available: true,
    });
  });

  test('fails recognitions that a restart cut off', async () => {
    const config = {
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: undefined,
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
      recognizer: undefined,
    };
    const stuck = { recognize: () => new Promise<never>(() => {}) };
    const first = await bootstrap(config, { recognizer: stuck });
    cleanups.push(first.close);
    const username = `member_${crypto.randomUUID().slice(0, 8)}`;
    const password = 'password-restart';
    await first.app.request(
      '/api/setup',
      jsonRequest('POST', { householdName: 'Home', username, password, name: 'Member' }),
    );
    const signedIn = await first.app.request('/api/auth/sign-in/username', jsonRequest('POST', { username, password }));
    const cookie = sessionCookie(signedIn);
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'a.png'));
    const started = await first.app.request('/api/recognitions', { method: 'POST', body: form, headers: { cookie } });
    const { id, status } = (await started.json()) as { id: string; status: string };
    expect(status).toBe('pending');

    const second = await bootstrap(config, { recognizer: stuck });
    cleanups.push(second.close);
    const res = await second.app.request(`/api/recognitions/${id}`, { headers: { cookie } });
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'recognition_interrupted' });
  });
});
