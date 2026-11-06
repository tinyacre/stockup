import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { bootstrap } from '../src/main';
import { s3EvidenceStore } from '../src/s3-evidence-store';
import { fakeRecognizerFactory, instanceRecognition } from './support/fake-recognizer';
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
      recognition: undefined,
      encryptionKey: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
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
        STOCKUP_RECOGNITION_PROVIDER: 'openai',
        STOCKUP_RECOGNITION_API_KEY: 'sk-or-test',
        STOCKUP_RECOGNITION_BASE_URL: 'https://openrouter.ai/api/v1',
        STOCKUP_RECOGNITION_MODEL: 'google/gemini-3-flash',
        STOCKUP_RECOGNITION_MONTHLY_QUOTA: '50',
      }),
    ).toEqual({
      databaseUrl: 'postgres://x/y',
      authSecret: testAuthSecret,
      baseUrl: 'https://stockup.example.com',
      port: 3000,
      evidenceDir: '/srv/evidence',
      webDir: '/srv/web',
      clientIpHeader: 'cf-connecting-ip',
      recognition: {
        recognizer: {
          provider: 'openai',
          apiKey: 'sk-or-test',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'google/gemini-3-flash',
        },
        monthlyQuota: 50,
      },
      encryptionKey: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
    });
  });

  const recognition = { ...required, STOCKUP_RECOGNITION_MONTHLY_QUOTA: '30' };

  test("leaves the model to the provider's default unless one is set", () => {
    expect(
      loadConfig({
        ...recognition,
        STOCKUP_RECOGNITION_PROVIDER: 'Anthropic',
        STOCKUP_RECOGNITION_API_KEY: 'sk-ant-test',
      }).recognition,
    ).toEqual({
      recognizer: { provider: 'anthropic', apiKey: 'sk-ant-test', baseURL: null, model: null },
      monthlyQuota: 30,
    });
  });

  test('leaves recognition unconfigured while every recognition variable is empty', () => {
    expect(
      loadConfig({ ...required, STOCKUP_RECOGNITION_PROVIDER: '', STOCKUP_RECOGNITION_API_KEY: '' }).recognition,
    ).toBeUndefined();
  });

  test('leaves recognition unconfigured with a quota of 0 and no provider', () => {
    expect(loadConfig({ ...required, STOCKUP_RECOGNITION_MONTHLY_QUOTA: '0' }).recognition).toBeUndefined();
  });

  test('names every missing recognition variable when only some are set', () => {
    expect(() => loadConfig({ ...required, STOCKUP_RECOGNITION_MODEL: 'gpt-5-mini' })).toThrow(
      'Screenshot recognition is configured but STOCKUP_RECOGNITION_PROVIDER, STOCKUP_RECOGNITION_API_KEY, STOCKUP_RECOGNITION_MONTHLY_QUOTA not set',
    );
    expect(() => loadConfig({ ...recognition, STOCKUP_RECOGNITION_PROVIDER: 'openai' })).toThrow(
      'Screenshot recognition is configured but STOCKUP_RECOGNITION_API_KEY not set',
    );
    expect(() => loadConfig({ ...required, STOCKUP_RECOGNITION_MONTHLY_QUOTA: '30' })).toThrow(
      'Screenshot recognition is configured but STOCKUP_RECOGNITION_PROVIDER, STOCKUP_RECOGNITION_API_KEY not set',
    );
  });

  test('requires a monthly quota with a provider', () => {
    expect(() =>
      loadConfig({ ...required, STOCKUP_RECOGNITION_PROVIDER: 'openai', STOCKUP_RECOGNITION_API_KEY: 'key' }),
    ).toThrow('Screenshot recognition is configured but STOCKUP_RECOGNITION_MONTHLY_QUOTA not set');
  });

  test('takes a quota of 0 as offering no recognition on the provider', () => {
    expect(
      loadConfig({
        ...required,
        STOCKUP_RECOGNITION_PROVIDER: 'openai',
        STOCKUP_RECOGNITION_API_KEY: 'key',
        STOCKUP_RECOGNITION_MONTHLY_QUOTA: '0',
      }).recognition,
    ).toBeUndefined();
  });

  test('rejects a quota that is not a whole number', () => {
    for (const quota of ['-1', '1.5', 'many']) {
      expect(() =>
        loadConfig({
          ...required,
          STOCKUP_RECOGNITION_PROVIDER: 'openai',
          STOCKUP_RECOGNITION_API_KEY: 'key',
          STOCKUP_RECOGNITION_MONTHLY_QUOTA: quota,
        }),
      ).toThrow('STOCKUP_RECOGNITION_MONTHLY_QUOTA');
    }
  });

  test('reads the encryption key as 32 bytes in base64', () => {
    const key = Buffer.alloc(32, 7);
    expect(loadConfig({ ...required, STOCKUP_ENCRYPTION_KEY: key.toString('base64') }).encryptionKey).toEqual(key);
    expect(loadConfig({ ...required, STOCKUP_ENCRYPTION_KEY: '' }).encryptionKey).toBeUndefined();
  });

  test('rejects an encryption key that is not 32 bytes in base64', () => {
    for (const value of [Buffer.alloc(16).toString('base64'), 'a'.repeat(32), Buffer.alloc(32).toString('hex')]) {
      expect(() => loadConfig({ ...required, STOCKUP_ENCRYPTION_KEY: value })).toThrow('STOCKUP_ENCRYPTION_KEY');
    }
  });

  test('rejects a provider other than Anthropic or OpenAI', () => {
    expect(() =>
      loadConfig({ ...recognition, STOCKUP_RECOGNITION_PROVIDER: 'gemini', STOCKUP_RECOGNITION_API_KEY: 'key' }),
    ).toThrow('STOCKUP_RECOGNITION_PROVIDER');
  });

  test('rejects a base URL that is not http(s)', () => {
    for (const baseURL of ['openrouter.ai/api/v1', 'ftp://openrouter.ai']) {
      expect(() =>
        loadConfig({
          ...recognition,
          STOCKUP_RECOGNITION_PROVIDER: 'openai',
          STOCKUP_RECOGNITION_API_KEY: 'key',
          STOCKUP_RECOGNITION_BASE_URL: baseURL,
        }),
      ).toThrow('STOCKUP_RECOGNITION_BASE_URL');
    }
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

describe('loadConfig for telemetry', () => {
  const serverDsn = 'https://0123abcd@errors.example.com/5';
  const webDsn = 'https://4567cdef@errors.example.com/4';

  test('reports nothing anywhere unless configured', () => {
    const config = loadConfig(required);
    expect(config.errorReportDsn).toBeUndefined();
    expect(config.webTelemetry).toBeUndefined();
  });

  test('names the release the image was built as', () => {
    expect(loadConfig({ ...required, STOCKUP_RELEASE: '1.4.0' }).release).toBe('1.4.0');
  });

  test("reports the server's errors to the server DSN", () => {
    expect(loadConfig({ ...required, STOCKUP_SERVER_GLITCHTIP_DSN: serverDsn }).errorReportDsn).toBe(serverDsn);
  });

  test('turns on web telemetry with both the Umami website and the web DSN', () => {
    expect(
      loadConfig({ ...required, STOCKUP_UMAMI_WEBSITE_ID: 'site-id', STOCKUP_WEB_GLITCHTIP_DSN: webDsn }).webTelemetry,
    ).toEqual({ umamiWebsiteId: 'site-id', glitchtipDsn: webDsn });
  });

  test('refuses to start with only half of web telemetry', () => {
    expect(() => loadConfig({ ...required, STOCKUP_UMAMI_WEBSITE_ID: 'site-id' })).toThrow(
      'Web telemetry is configured but STOCKUP_WEB_GLITCHTIP_DSN not set',
    );
    expect(() => loadConfig({ ...required, STOCKUP_WEB_GLITCHTIP_DSN: webDsn })).toThrow(
      'Web telemetry is configured but STOCKUP_UMAMI_WEBSITE_ID not set',
    );
  });

  test('rejects a DSN without a public key or project', () => {
    for (const dsn of ['errors.example.com/5', 'https://errors.example.com/5', 'https://key@errors.example.com/']) {
      expect(() => loadConfig({ ...required, STOCKUP_SERVER_GLITCHTIP_DSN: dsn })).toThrow(
        `STOCKUP_SERVER_GLITCHTIP_DSN must be a DSN such as https://<public key>@<host>/<project id>, got "${dsn}"`,
      );
    }
    expect(() =>
      loadConfig({ ...required, STOCKUP_UMAMI_WEBSITE_ID: 'site-id', STOCKUP_WEB_GLITCHTIP_DSN: 'nope' }),
    ).toThrow('STOCKUP_WEB_GLITCHTIP_DSN must be a DSN');
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
      recognition: undefined,
      encryptionKey: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
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

  test('makes recognition available once a provider is configured', async () => {
    const config = {
      databaseUrl: await emptyDatabaseUrl(),
      authSecret: testAuthSecret,
      baseUrl: 'http://localhost',
      port: 0,
      evidenceDir: path.join(mkdtempSync(path.join(tmpdir(), 'stockup-')), 'evidence'),
      webDir: undefined,
      clientIpHeader: undefined,
      recognition: undefined,
      encryptionKey: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
    };
    const without = await bootstrap(config);
    cleanups.push(without.close);
    const configured = await bootstrap({
      ...config,
      recognition: {
        recognizer: { provider: 'openai', apiKey: 'sk-test', baseURL: null, model: null },
        monthlyQuota: 20,
      },
    });
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

    expect(await (await without.app.request('/api/recognizer', { headers: { cookie } })).json()).toMatchObject({
      available: false,
    });
    expect(await (await configured.app.request('/api/recognizer', { headers: { cookie } })).json()).toMatchObject({
      available: true,
      quota: { monthly: 20 },
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
      recognition: instanceRecognition,
      encryptionKey: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
    };
    const recognizers = fakeRecognizerFactory();
    recognizers.recognizer.respond = () => new Promise<never>(() => {});
    const first = await bootstrap(config, { recognizers });
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

    const second = await bootstrap(config, { recognizers });
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
      telemetry: null,
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
      recognition: undefined,
      encryptionKey: undefined,
      s3: undefined,
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
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
      recognition: undefined,
      encryptionKey: undefined,
      s3: testS3Config(),
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
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
      recognition: undefined,
      encryptionKey: undefined,
      s3: testS3Config({ bucket: `stockup-missing-${crypto.randomUUID().slice(0, 8)}` }),
      signup: 'closed' as const,
      smtp: undefined,
      turnstile: undefined,
      release: 'dev',
      errorReportDsn: undefined,
      webTelemetry: undefined,
    };
    await expect(bootstrap(config)).rejects.toThrow(
      `S3 bucket ${config.s3.bucket} at ${config.s3.endpoint} cannot be written`,
    );
  });
});
