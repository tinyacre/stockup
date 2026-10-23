import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { bootstrap } from '../src/main';
import { s3EvidenceStore } from '../src/s3-evidence-store';
import { createTestDatabase, jsonRequest, sessionCookie, testAuthSecret } from './support/harness';
import { testS3Config } from './support/s3';

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
    expect(loadConfig({ ...required, STOCKUP_BASE_URL: 'http://192.168.1.10:8080' }).baseUrl).toBe(
      'http://192.168.1.10:8080',
    );
  });

  test('applies defaults for optional settings', () => {
    expect(loadConfig(required)).toEqual({
      databaseUrl: 'postgres://x/y',
      authSecret: testAuthSecret,
      baseUrl: 'https://stockup.example.com',
      port: 8080,
      evidenceDir: path.resolve('data/evidence'),
      webDir: undefined,
      clientIpHeader: undefined,
      recognizer: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
    });
  });

  test('reads every setting from the environment', () => {
    expect(
      loadConfig({
        ...required,
        STOCKUP_PORT: '3000',
        STOCKUP_EVIDENCE_DIR: '/srv/evidence',
        STOCKUP_WEB_DIR: '/srv/web',
        STOCKUP_CLIENT_IP_HEADER: 'CF-Connecting-IP',
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
      clientIpHeader: 'cf-connecting-ip',
      recognizer: { apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5' },
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
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
    expect(() => loadConfig({ ...required, STOCKUP_PORT: 'abc' })).toThrow('STOCKUP_PORT');
  });
});

describe('loadConfig for S3 evidence storage', () => {
  const s3 = {
    STOCKUP_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    STOCKUP_S3_BUCKET: 'stockup-evidence',
    STOCKUP_S3_ACCESS_KEY_ID: 'key-id',
    STOCKUP_S3_SECRET_ACCESS_KEY: 'secret',
  };

  test('stores evidence in S3 once the bucket and credentials are set, in us-east-1 by virtual host unless told otherwise', () => {
    expect(loadConfig({ ...required, ...s3 }).s3).toEqual({
      endpoint: 'https://account.r2.cloudflarestorage.com',
      region: 'us-east-1',
      bucket: 'stockup-evidence',
      accessKeyId: 'key-id',
      secretAccessKey: 'secret',
      pathStyle: false,
    });
  });

  test('reads the region and path style', () => {
    expect(
      loadConfig({ ...required, ...s3, STOCKUP_S3_REGION: 'auto', STOCKUP_S3_PATH_STYLE: 'true' }).s3,
    ).toMatchObject({ region: 'auto', pathStyle: true });
    for (const value of ['1', 'yes', 'TRUE']) {
      expect(loadConfig({ ...required, ...s3, STOCKUP_S3_PATH_STYLE: value }).s3?.pathStyle).toBe(true);
    }
    for (const value of ['0', 'no', 'false', '']) {
      expect(loadConfig({ ...required, ...s3, STOCKUP_S3_PATH_STYLE: value }).s3?.pathStyle).toBe(false);
    }
  });

  test('rejects a path style that is neither true nor false', () => {
    expect(() => loadConfig({ ...required, ...s3, STOCKUP_S3_PATH_STYLE: 'maybe' })).toThrow('STOCKUP_S3_PATH_STYLE');
  });

  test('names every missing variable when only some are set', () => {
    expect(() =>
      loadConfig({ ...required, STOCKUP_S3_ENDPOINT: s3.STOCKUP_S3_ENDPOINT, STOCKUP_S3_ACCESS_KEY_ID: 'key-id' }),
    ).toThrow('S3 evidence storage is configured but STOCKUP_S3_BUCKET, STOCKUP_S3_SECRET_ACCESS_KEY not set');
    expect(() => loadConfig({ ...required, ...s3, STOCKUP_S3_BUCKET: '' })).toThrow(
      'S3 evidence storage is configured but STOCKUP_S3_BUCKET not set',
    );
  });

  test('counts the region or path style alone as a partial S3 setup', () => {
    const missing =
      'S3 evidence storage is configured but STOCKUP_S3_ENDPOINT, STOCKUP_S3_BUCKET, STOCKUP_S3_ACCESS_KEY_ID, STOCKUP_S3_SECRET_ACCESS_KEY not set';
    expect(() => loadConfig({ ...required, STOCKUP_S3_REGION: 'auto' })).toThrow(missing);
    expect(() => loadConfig({ ...required, STOCKUP_S3_PATH_STYLE: 'true' })).toThrow(missing);
  });

  test('accepts only a bare http(s) origin as the endpoint', () => {
    expect(loadConfig({ ...required, ...s3, STOCKUP_S3_ENDPOINT: 'http://127.0.0.1:9000/' }).s3?.endpoint).toBe(
      'http://127.0.0.1:9000',
    );
    for (const endpoint of [
      'minio:9000',
      'ftp://host',
      'https://host/bucket',
      'https://host?x=1',
      'https://user:pw@host',
    ]) {
      expect(() => loadConfig({ ...required, ...s3, STOCKUP_S3_ENDPOINT: endpoint })).toThrow('STOCKUP_S3_ENDPOINT');
    }
  });
});

describe('loadConfig for SMTP and signup', () => {
  const smtp = { STOCKUP_SMTP_HOST: 'smtp.example.com', STOCKUP_SMTP_FROM: 'StockUp <noreply@example.com>' };

  test('keeps signup closed and mail off by default', () => {
    expect(loadConfig(required)).toMatchObject({ signup: 'closed', smtp: undefined });
  });

  test('sends with mandatory STARTTLS on port 587 and no login unless told otherwise', () => {
    expect(loadConfig({ ...required, ...smtp }).smtp).toEqual({
      host: 'smtp.example.com',
      port: 587,
      username: undefined,
      password: undefined,
      from: 'StockUp <noreply@example.com>',
      tls: 'starttls',
    });
  });

  test('picks the standard port for each TLS mode, and reads every setting', () => {
    expect(loadConfig({ ...required, ...smtp, STOCKUP_SMTP_TLS: 'implicit' }).smtp?.port).toBe(465);
    expect(loadConfig({ ...required, ...smtp, STOCKUP_SMTP_TLS: 'none' }).smtp?.port).toBe(25);
    expect(
      loadConfig({
        ...required,
        STOCKUP_SMTP_HOST: 'mail.example.com',
        STOCKUP_SMTP_PORT: '2525',
        STOCKUP_SMTP_USERNAME: 'stockup',
        STOCKUP_SMTP_PASSWORD: 'secret',
        STOCKUP_SMTP_FROM: 'noreply@example.com',
        STOCKUP_SMTP_TLS: 'implicit',
      }).smtp,
    ).toEqual({
      host: 'mail.example.com',
      port: 2525,
      username: 'stockup',
      password: 'secret',
      from: 'noreply@example.com',
      tls: 'implicit',
    });
  });

  test('names every missing variable when only some are set', () => {
    expect(() => loadConfig({ ...required, STOCKUP_SMTP_PASSWORD: 'secret' })).toThrow(
      'SMTP is configured but STOCKUP_SMTP_HOST, STOCKUP_SMTP_FROM not set',
    );
    expect(() => loadConfig({ ...required, STOCKUP_SMTP_HOST: 'smtp.example.com' })).toThrow(
      'SMTP is configured but STOCKUP_SMTP_FROM not set',
    );
  });

  test('rejects a password without a username', () => {
    expect(() => loadConfig({ ...required, ...smtp, STOCKUP_SMTP_PASSWORD: 'secret' })).toThrow(
      'STOCKUP_SMTP_PASSWORD is set but STOCKUP_SMTP_USERNAME is not',
    );
  });

  test('rejects a sender that is not an email address', () => {
    for (const from of ['noreply', 'StockUp <noreply>', 'a@b.com, c@d.com']) {
      expect(() => loadConfig({ ...required, ...smtp, STOCKUP_SMTP_FROM: from })).toThrow(
        `STOCKUP_SMTP_FROM "${from}" is not an email address`,
      );
    }
  });

  test('rejects an unknown TLS mode or a bad port', () => {
    expect(() => loadConfig({ ...required, ...smtp, STOCKUP_SMTP_TLS: 'ssl' })).toThrow('STOCKUP_SMTP_TLS');
    for (const port of ['0', '65536', 'smtp']) {
      expect(() => loadConfig({ ...required, ...smtp, STOCKUP_SMTP_PORT: port })).toThrow('STOCKUP_SMTP_PORT');
    }
  });

  test('opens signup only when asked, and only with SMTP', () => {
    expect(loadConfig({ ...required, ...smtp, STOCKUP_SIGNUP: 'open' }).signup).toBe('open');
    expect(loadConfig({ ...required, STOCKUP_SIGNUP: 'closed' }).signup).toBe('closed');
    expect(() => loadConfig({ ...required, STOCKUP_SIGNUP: 'open' })).toThrow(
      'STOCKUP_SIGNUP=open requires SMTP: set STOCKUP_SMTP_HOST and STOCKUP_SMTP_FROM',
    );
    expect(() => loadConfig({ ...required, ...smtp, STOCKUP_SIGNUP: 'yes' })).toThrow(
      'STOCKUP_SIGNUP must be open or closed, got "yes"',
    );
  });
});

describe('loadConfig for Turnstile', () => {
  test('stays off without keys', () => {
    expect(loadConfig(required).turnstile).toBeUndefined();
  });

  test('turns on with both keys', () => {
    expect(
      loadConfig({ ...required, STOCKUP_TURNSTILE_SITE_KEY: 'site', STOCKUP_TURNSTILE_SECRET_KEY: 'secret' }).turnstile,
    ).toEqual({ siteKey: 'site', secretKey: 'secret' });
  });

  test('refuses to start with only one key', () => {
    expect(() => loadConfig({ ...required, STOCKUP_TURNSTILE_SITE_KEY: 'site' })).toThrow(
      'Turnstile is configured but STOCKUP_TURNSTILE_SECRET_KEY not set',
    );
    expect(() => loadConfig({ ...required, STOCKUP_TURNSTILE_SECRET_KEY: 'secret' })).toThrow(
      'Turnstile is configured but STOCKUP_TURNSTILE_SITE_KEY not set',
    );
    expect(() =>
      loadConfig({ ...required, STOCKUP_TURNSTILE_SITE_KEY: 'site', STOCKUP_TURNSTILE_SECRET_KEY: '' }),
    ).toThrow('Turnstile is configured but STOCKUP_TURNSTILE_SECRET_KEY not set');
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
      clientIpHeader: undefined,
      recognizer: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
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
      baseUrl: 'http://localhost',
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
      clientIpHeader: undefined,
      recognizer: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
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
    const signedIn = await without.app.request(
      '/api/auth/sign-in/username',
      jsonRequest('POST', { username, password }),
    );
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
      baseUrl: 'http://localhost',
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
      clientIpHeader: undefined,
      recognizer: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
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

  test('offers signup once it is open and SMTP is configured', async () => {
    const { app, close } = await bootstrap(
      loadConfig({
        STOCKUP_DATABASE_URL: await emptyDatabaseUrl(),
        STOCKUP_AUTH_SECRET: testAuthSecret,
        STOCKUP_BASE_URL: 'http://localhost',
        STOCKUP_EVIDENCE_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
        STOCKUP_SIGNUP: 'open',
        STOCKUP_SMTP_HOST: 'smtp.invalid',
        STOCKUP_SMTP_FROM: 'noreply@stockup.invalid',
      }),
    );
    cleanups.push(close);
    expect(await (await app.request('/api/capabilities')).json()).toEqual({
      signup: true,
      email: true,
      turnstileSiteKey: null,
    });
  });

  test('challenges sign-in with the configured Turnstile keys', async () => {
    const { app, close } = await bootstrap(
      loadConfig({
        STOCKUP_DATABASE_URL: await emptyDatabaseUrl(),
        STOCKUP_AUTH_SECRET: testAuthSecret,
        STOCKUP_BASE_URL: 'http://localhost',
        STOCKUP_EVIDENCE_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
        STOCKUP_TURNSTILE_SITE_KEY: 'site-key',
        STOCKUP_TURNSTILE_SECRET_KEY: 'secret-key',
      }),
    );
    cleanups.push(close);
    expect(await (await app.request('/api/capabilities')).json()).toMatchObject({ turnstileSiteKey: 'site-key' });
    // Without a token the verifier refuses before calling Cloudflare.
    const res = await app.request(
      '/api/auth/sign-in/username',
      jsonRequest('POST', { username: 'someone', password: 'password' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'turnstile_failed' });
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
      clientIpHeader: undefined,
      recognizer: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
    });
    cleanups.push(close);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MCP'));
    warn.mockRestore();

    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/mcp', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
  });

  test('serves evidence from S3 with the same headers and no local directory', async () => {
    const evidenceDir = path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence');
    const { app, close } = await bootstrap({
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: 'http://localhost',
      port: 0,
      evidenceDir,
      webDir: undefined,
      clientIpHeader: undefined,
      recognizer: undefined,
      s3: testS3Config(),
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
    });
    cleanups.push(close);
    expect(existsSync(evidenceDir)).toBe(false);

    const username = `member_${crypto.randomUUID().slice(0, 8)}`;
    const password = 'password-s3-evidence';
    await app.request('/api/setup', jsonRequest('POST', { householdName: 'Home', username, password, name: 'Member' }));
    const cookie = sessionCookie(
      await app.request('/api/auth/sign-in/username', jsonRequest('POST', { username, password })),
    );
    const asMember = (url: string, init: RequestInit = {}) =>
      app.request(url, { ...init, headers: { ...init.headers, cookie } });
    const created = async (res: Response) => {
      expect(res.status).toBe(201);
      return (await res.json()) as { id: string };
    };
    const group = await created(await asMember('/api/category-groups', jsonRequest('POST', { name: '生活用品' })));
    const category = await created(
      await asMember('/api/categories', jsonRequest('POST', { name: '抽纸', categoryGroupId: group.id })),
    );
    const product = await created(
      await asMember(
        '/api/products',
        jsonRequest('POST', {
          categoryId: category.id,
          name: '得宝抽纸',
          pricingUnit: { dimension: 'count', name: '抽' },
          baseSize: 90,
        }),
      ),
    );
    const channel = await created(await asMember('/api/channels', jsonRequest('POST', { name: '京东' })));
    const record = await created(
      await asMember(
        '/api/price-records',
        jsonRequest('POST', {
          productId: product.id,
          channelId: channel.id,
          date: '2026-06-18',
          purchased: true,
          listPrice: 9900,
          discounts: [],
          quantity: 18,
          size: { amount: 130, unit: { dimension: 'count', name: '抽' } },
        }),
      ),
    );
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const form = new FormData();
    form.append('files', new File([png], 'order.png', { type: 'image/png' }));
    const uploaded = await asMember(`/api/price-records/${record.id}/evidence`, { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const [evidence] = (await uploaded.json()) as { id: string }[];
    expect(await s3EvidenceStore(testS3Config()).has(evidence!.id)).toBe(true);

    const read = await asMember(`/api/evidence/${evidence!.id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(read.headers.get('x-content-type-options')).toBe('nosniff');
    expect(read.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(png);

    expect((await asMember(`/api/evidence/${evidence!.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await s3EvidenceStore(testS3Config()).has(evidence!.id)).toBe(false);
  });

  test('refuses to start when the S3 bucket cannot be written', async () => {
    const config = {
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: 'http://localhost',
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
      clientIpHeader: undefined,
      recognizer: undefined,
      s3: testS3Config({ bucket: `stockup-missing-${crypto.randomUUID().slice(0, 8)}` }),
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
    };
    await expect(bootstrap(config)).rejects.toThrow(
      `S3 bucket ${config.s3.bucket} at ${config.s3.endpoint} cannot be written`,
    );
  });
});
