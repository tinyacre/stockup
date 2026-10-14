import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { bootstrap } from '../src/main';
import { createTestDatabase, jsonRequest, sessionCookie, testAuthSecret } from './support/harness';

const required = {
  STOCKUP_DATABASE_URL: 'postgres://x/y',
  STOCKUP_AUTH_SECRET: testAuthSecret,
  STOCKUP_BASE_URL: 'https://stockup.example.com',
};

describe('loadConfig', () => {
  test('requires a database URL', () => {
    expect(() => loadConfig({ ...required, STOCKUP_DATABASE_URL: undefined })).toThrow('STOCKUP_DATABASE_URL');
  });

  test('requires a long enough auth secret', () => {
    expect(() => loadConfig({ ...required, STOCKUP_AUTH_SECRET: undefined })).toThrow('STOCKUP_AUTH_SECRET');
    expect(() => loadConfig({ ...required, STOCKUP_AUTH_SECRET: 'too-short' })).toThrow('STOCKUP_AUTH_SECRET');
  });

  test('requires the public base URL', () => {
    expect(() => loadConfig({ ...required, STOCKUP_BASE_URL: undefined })).toThrow('STOCKUP_BASE_URL');
    expect(() => loadConfig({ ...required, STOCKUP_BASE_URL: 'stockup.example.com' })).toThrow('STOCKUP_BASE_URL');
  });

  test('accepts a plain-HTTP base URL on the local network', () => {
    expect(loadConfig({ ...required, STOCKUP_BASE_URL: 'http://192.168.1.10:8080' }).baseUrl).toBe('http://192.168.1.10:8080');
  });

  test('applies defaults for optional settings', () => {
    expect(loadConfig(required)).toEqual({
      databaseUrl: 'postgres://x/y',
      authSecret: testAuthSecret,
      baseUrl: 'https://stockup.example.com',
      port: 8080,
      evidenceDir: path.resolve('data/evidence'),
      webDir: undefined,
    });
  });

  test('reads every setting from the environment', () => {
    expect(
      loadConfig({
        ...required,
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
      baseUrl: 'http://localhost',
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

  test('fails recognitions that a restart cut off', async () => {
    const config = {
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: 'http://localhost',
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
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

  test('serves without MCP when the base URL is plain HTTP off loopback', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const { app, close } = await bootstrap({
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: 'http://192.168.1.10:8080',
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
    });
    cleanups.push(close);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MCP'));
    warn.mockRestore();

    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/mcp', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
  });
});
