import { describe, expect, test } from 'bun:test';
import { jsonRequest, requestAs, signIn, signUpHousehold, useTestApp } from './support/harness';

const capabilities = async (ctx: ReturnType<typeof useTestApp>) =>
  (await (await ctx.app.request('/api/capabilities')).json()) as { telemetry: unknown };

describe('an instance without web telemetry', () => {
  const ctx = useTestApp();

  test('tells the browser to load none', async () => {
    expect((await capabilities(ctx)).telemetry).toBeNull();
  });
});

describe('an instance with web telemetry', () => {
  const ctx = useTestApp({
    release: '1.4.0',
    webTelemetry: { umamiWebsiteId: 'site-id', glitchtipDsn: 'https://4567cdef@errors.example.com/4' },
  });

  test('hands the browser its configuration, sending through same-origin paths', async () => {
    expect((await capabilities(ctx)).telemetry).toEqual({
      release: '1.4.0',
      umami: { endpoint: '/_s/api/send', websiteId: 'site-id', hostname: 'localhost' },
      sentry: {
        dsn: 'https://4567cdef@errors.example.com/4',
        tunnel: '/_e/api/4/envelope/',
      },
    });
  });
});

describe('the help-improve switch', () => {
  const ctx = useTestApp();

  test('a new account helps improve StockUp', async () => {
    const member = await signUpHousehold(ctx);
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { telemetryEnabled: true } });
  });

  test('a member turns it off and every session of the account sees it', async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request('/api/me', jsonRequest('PATCH', { telemetryEnabled: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { name: member.name, theme: 'tool', telemetryEnabled: false } });

    const phone = await signIn(ctx, member.username, member.password);
    expect(await (await requestAs(ctx, phone, '/api/me')).json()).toMatchObject({ user: { telemetryEnabled: false } });

    await member.request('/api/me', jsonRequest('PATCH', { telemetryEnabled: true }));
    expect(await (await requestAs(ctx, phone, '/api/me')).json()).toMatchObject({ user: { telemetryEnabled: true } });
  });

  test("turning it off changes no one else's", async () => {
    const member = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    await member.request('/api/me', jsonRequest('PATCH', { telemetryEnabled: false }));
    expect(await (await other.request('/api/me')).json()).toMatchObject({ user: { telemetryEnabled: true } });
  });

  test('changing the theme or name keeps the choice', async () => {
    const member = await signUpHousehold(ctx);
    await member.request('/api/me', jsonRequest('PATCH', { telemetryEnabled: false }));
    await member.request('/api/me', jsonRequest('PATCH', { theme: 'price-tag', name: '新名字' }));
    expect(await (await member.request('/api/me')).json()).toMatchObject({
      user: { name: '新名字', theme: 'price-tag', telemetryEnabled: false },
    });
  });

  test('Better Auth refuses to set it through its own endpoints', async () => {
    const member = await signUpHousehold(ctx);
    await member.request('/api/auth/update-user', jsonRequest('POST', { telemetryEnabled: false }));
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { telemetryEnabled: true } });
  });

  test('rejects a value that is not a boolean', async () => {
    const member = await signUpHousehold(ctx);
    expect((await member.request('/api/me', jsonRequest('PATCH', { telemetryEnabled: 'no' }))).status).toBe(400);
  });
});
