import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { cloudflareTurnstile } from '../src/turnstile';
import { fakeMailer } from './support/fake-mailer';
import { fakeTurnstile, PASSING_TURNSTILE_TOKEN } from './support/fake-turnstile';
import {
  jsonRequest,
  requestAs,
  signUpHousehold,
  signUpWithEmail,
  useTestApp,
  type TestContext,
} from './support/harness';
import { authorizeAsClaude } from './support/mcp-client';

const missing = undefined;
const invalid = 'turnstile-fail';

function withToken(init: RequestInit, token: string | undefined): RequestInit {
  const headers = new Headers(init.headers);
  if (token !== undefined) headers.set('x-turnstile-token', token);
  return { ...init, headers };
}

function post(
  ctx: TestContext,
  path: string,
  body: unknown,
  token: string | undefined,
  headers?: Record<string, string>,
) {
  return ctx.app.request(
    path,
    withToken({ ...jsonRequest('POST', body), headers: { 'content-type': 'application/json', ...headers } }, token),
  );
}

async function expectRefused(res: Response) {
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'turnstile_failed' });
}

function newVisitor() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    email: `visitor_${suffix}@example.com`,
    username: `visitor_${suffix}`,
    password: `password-${suffix}`,
    name: `访客 ${suffix}`,
  };
}

describe('an instance with Turnstile', () => {
  const mailer = fakeMailer();
  const turnstile = fakeTurnstile();
  const ctx = useTestApp({ mailer, signupOpen: true, turnstile, clientIpHeader: 'cf-connecting-ip', listen: true });

  test('hands the site key to the browser', async () => {
    expect(await (await ctx.app.request('/api/capabilities')).json()).toEqual({
      signup: true,
      email: true,
      turnstileSiteKey: 'test-site-key',
      telemetry: null,
    });
  });

  test('sends a code only with a passing token, for every purpose', async () => {
    const member = await signUpHousehold(ctx);
    const invited = await member.request('/api/invitations', jsonRequest('POST', { expiresInDays: 1 }));
    const { id: invitationId } = (await invited.json()) as { id: string };
    const purposes = [
      { purpose: 'register' },
      { purpose: 'password-reset' },
      { purpose: 'join', invitationId },
      { purpose: 'change-email', cookie: member.cookie },
    ];
    for (const { cookie, ...body } of purposes) {
      const email = newVisitor().email;
      const headers = cookie ? { cookie } : undefined;
      for (const token of [missing, invalid]) {
        await expectRefused(await post(ctx, '/api/email-codes', { ...body, email }, token, headers));
      }
      await mailer.expectNoMailTo(email, 50);
      expect((await post(ctx, '/api/email-codes', { ...body, email }, PASSING_TURNSTILE_TOKEN, headers)).status).toBe(
        204,
      );
    }
  });

  test('rejects a malformed email before spending the token', async () => {
    const before = turnstile.calls.length;
    const res = await post(
      ctx,
      '/api/email-codes',
      { email: 'not-an-email', purpose: 'register' },
      PASSING_TURNSTILE_TOKEN,
    );
    expect(res.status).toBe(400);
    expect(turnstile.calls.length).toBe(before);
  });

  test('registers only with a passing token, leaving the code usable after a refusal', async () => {
    const visitor = newVisitor();
    await post(ctx, '/api/email-codes', { email: visitor.email, purpose: 'register' }, PASSING_TURNSTILE_TOKEN);
    const code = await mailer.codeFor(visitor.email);
    for (const token of [missing, invalid]) {
      await expectRefused(await post(ctx, '/api/signup', { ...visitor, code }, token));
    }
    expect((await post(ctx, '/api/signup', { ...visitor, code }, PASSING_TURNSTILE_TOKEN)).status).toBe(201);
  });

  test('signs in by username or email only with a passing token', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    for (const username of [member.username, member.email]) {
      for (const token of [missing, invalid]) {
        await expectRefused(
          await post(ctx, '/api/auth/sign-in/username', { username, password: member.password }, token),
        );
      }
      const res = await post(
        ctx,
        '/api/auth/sign-in/username',
        { username, password: member.password },
        PASSING_TURNSTILE_TOKEN,
      );
      expect(res.status).toBe(200);
    }
    await expectRefused(
      await post(ctx, '/api/auth/sign-in/email', { email: member.email, password: member.password }, missing),
    );
  });

  test('challenges the sign-in that continues an MCP authorization like any other', async () => {
    const member = await signUpHousehold(ctx);
    for (const token of [missing, invalid]) {
      const body = { username: member.username, password: member.password, oauth_query: 'client_id=x&state=y' };
      await expectRefused(await post(ctx, '/api/auth/sign-in/username', body, token));
    }
    const { accessToken } = await authorizeAsClaude(ctx.baseUrl, member);
    expect(accessToken).toBeString();
  });

  test('resets a password only with a passing token, leaving the code usable after a refusal', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    await post(ctx, '/api/email-codes', { email: member.email, purpose: 'password-reset' }, PASSING_TURNSTILE_TOKEN);
    const body = { email: member.email, code: await mailer.codeFor(member.email), newPassword: 'a-new-password' };
    for (const token of [missing, invalid]) {
      await expectRefused(await post(ctx, '/api/password-reset', body, token));
    }
    expect((await post(ctx, '/api/password-reset', body, PASSING_TURNSTILE_TOKEN)).status).toBe(204);
  });

  test('joins a household only with a passing token, leaving the code usable after a refusal', async () => {
    const admin = await signUpHousehold(ctx);
    const invited = await admin.request('/api/invitations', jsonRequest('POST', { expiresInDays: 1 }));
    const { id } = (await invited.json()) as { id: string };
    const visitor = newVisitor();
    await post(
      ctx,
      '/api/email-codes',
      { email: visitor.email, purpose: 'join', invitationId: id },
      PASSING_TURNSTILE_TOKEN,
    );
    const body = { ...visitor, code: await mailer.codeFor(visitor.email) };
    for (const token of [missing, invalid]) {
      await expectRefused(await post(ctx, `/api/join/${id}`, body, token));
    }
    expect((await post(ctx, `/api/join/${id}`, body, PASSING_TURNSTILE_TOKEN)).status).toBe(201);
  });

  test('leaves the signed-in steps unchallenged', async () => {
    const member = await signUpHousehold(ctx);
    expect((await requestAs(ctx, member.cookie, '/api/me')).status).toBe(200);
    const res = await requestAs(ctx, member.cookie, '/api/auth/sign-out', jsonRequest('POST', {}));
    expect(res.status).toBe(200);
  });

  test('tells Cloudflare the address the proxy reports', async () => {
    const member = await signUpHousehold(ctx);
    await post(
      ctx,
      '/api/auth/sign-in/username',
      { username: member.username, password: member.password },
      PASSING_TURNSTILE_TOKEN,
      { 'cf-connecting-ip': '203.0.113.7' },
    );
    expect(turnstile.calls.at(-1)).toEqual({ token: PASSING_TURNSTILE_TOKEN, remoteIp: '203.0.113.7' });
  });
});

describe('an instance without Turnstile', () => {
  const mailer = fakeMailer();
  const ctx = useTestApp({ mailer, signupOpen: true });

  test('lets every request through without a token', async () => {
    const visitor = newVisitor();
    expect((await post(ctx, '/api/email-codes', { email: visitor.email, purpose: 'register' }, missing)).status).toBe(
      204,
    );
    const code = await mailer.codeFor(visitor.email);
    expect((await post(ctx, '/api/signup', { ...visitor, code }, missing)).status).toBe(201);
    const signedIn = await post(
      ctx,
      '/api/auth/sign-in/username',
      { username: visitor.email, password: visitor.password },
      missing,
    );
    expect(signedIn.status).toBe(200);
  });

  test('offers no site key', async () => {
    expect(
      ((await (await ctx.app.request('/api/capabilities')).json()) as { turnstileSiteKey: unknown }).turnstileSiteKey,
    ).toBeNull();
  });
});

describe('cloudflareTurnstile', () => {
  const config = { siteKey: 'site', secretKey: 'secret' };
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  function cloudflare(respond: (body: URLSearchParams, init: RequestInit) => Promise<Response> | Response) {
    const requests: { url: string; body: URLSearchParams; signal?: AbortSignal | null }[] = [];
    const fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
      const body = new URLSearchParams(init.body as string);
      requests.push({ url: String(url), body, signal: init.signal });
      return respond(body, init);
    }) as typeof globalThis.fetch;
    return { requests, verifier: cloudflareTurnstile(config, fetch) };
  }

  test('asks siteverify with the secret, the token and the client address', async () => {
    const { requests, verifier } = cloudflare(() => Response.json({ success: true }));
    expect(verifier.siteKey).toBe('site');
    expect(await verifier.verify('token', '203.0.113.7')).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(requests[0]!.body)).toEqual({
      secret: 'secret',
      response: 'token',
      remoteip: '203.0.113.7',
    });
    expect(requests[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  test('leaves the address out when it is unknown', async () => {
    const { requests, verifier } = cloudflare(() => Response.json({ success: true }));
    await verifier.verify('token', undefined);
    expect(requests[0]!.body.has('remoteip')).toBe(false);
  });

  test('refuses an empty token without asking Cloudflare', async () => {
    const { requests, verifier } = cloudflare(() => Response.json({ success: true }));
    expect(await verifier.verify('', undefined)).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test('refuses a token Cloudflare rejects', async () => {
    const { verifier } = cloudflare(() => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verifier.verify('token', undefined)).toBe(false);
  });

  test('refuses when Cloudflare cannot be reached or answers with an error', async () => {
    const answers = [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      () => new Response('bad gateway', { status: 502 }),
      () => new Response('not json', { status: 200 }),
      () => Response.json({ success: 'yes' }),
    ];
    for (const answer of answers) {
      const { verifier } = cloudflare(answer);
      expect(await verifier.verify('token', undefined)).toBe(false);
    }
    // An outage refuses every visitor, so the operator needs to see why.
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
