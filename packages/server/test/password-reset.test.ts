import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { user } from '../src/db/schema';
import { CLAUDE_CLIENT_ID } from './support/claude-metadata';
import { fakeMailer } from './support/fake-mailer';
import {
  jsonRequest,
  requestAs,
  signIn,
  signUpHousehold,
  signUpWithEmail,
  useTestApp,
  type TestContext,
} from './support/harness';
import { authorizeAsClaude } from './support/mcp-client';

function sendCode(ctx: TestContext, email: string) {
  return ctx.app.request('/api/email-codes', jsonRequest('POST', { email, purpose: 'password-reset' }));
}

function reset(ctx: TestContext, body: { email: string; code: string; newPassword: string }) {
  return ctx.app.request('/api/password-reset', jsonRequest('POST', body));
}

async function signInStatus(ctx: TestContext, username: string, password: string) {
  const res = await ctx.app.request('/api/auth/sign-in/username', jsonRequest('POST', { username, password }));
  return res.status;
}

const minutes = (n: number) => n * 60_000;
const newPassword = () => `new-password-${crypto.randomUUID().slice(0, 8)}`;

// Stops the clock at the current time, so the waits a test checks come out exact.
function freezeClock() {
  const start = new Date();
  setSystemTime(start);
  return start;
}

function advance(start: Date, ms: number) {
  setSystemTime(new Date(start.getTime() + ms));
}

afterEach(() => {
  setSystemTime();
});

describe('an instance without mail', () => {
  const ctx = useTestApp();

  test('cannot send reset codes or reset passwords', async () => {
    const sent = await sendCode(ctx, 'someone@example.com');
    expect(sent.status).toBe(403);
    expect(await sent.json()).toEqual({ error: 'email_unavailable' });

    const res = await reset(ctx, { email: 'someone@example.com', code: '123456', newPassword: newPassword() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'email_unavailable' });
  });

  test("leaves Better Auth's own password reset closed", async () => {
    const paths = ['request-password-reset', 'reset-password', 'reset-password/some-token', 'forget-password'];
    for (const path of paths.map((p) => `/api/auth/${p}`)) {
      const res = await ctx.app.request(path, jsonRequest('POST', { email: 'a@example.com', newPassword: 'x' }));
      expect(res.status).toBe(404);
    }
  });
});

describe('password reset', () => {
  const mailer = fakeMailer();
  const ctx = useTestApp({ mailer, signupOpen: true });

  test('a member resets the password with an emailed code, which signs out every session', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    const otherDevice = await signIn(ctx, member.email, member.password);

    expect((await sendCode(ctx, member.email.toUpperCase())).status).toBe(204);
    const code = await mailer.codeFor(member.email);
    expect(mailer.messages.at(-1)!.text).toContain('找回密码验证码');

    const password = newPassword();
    const res = await reset(ctx, { email: member.email, code, newPassword: password });
    expect(res.status).toBe(204);

    for (const cookie of [member.cookie, otherDevice]) {
      expect((await requestAs(ctx, cookie, '/api/me')).status).toBe(401);
    }
    expect(await signInStatus(ctx, member.username, member.password)).toBe(401);
    expect(await signInStatus(ctx, member.email, member.password)).toBe(401);
    const me = await requestAs(ctx, await signIn(ctx, member.username, password), '/api/me');
    expect(await me.json()).toMatchObject({ user: { id: member.userId } });
  });

  test('a code resets the password only once', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    await sendCode(ctx, member.email);
    const code = await mailer.codeFor(member.email);
    expect((await reset(ctx, { email: member.email, code, newPassword: newPassword() })).status).toBe(204);

    const again = await reset(ctx, { email: member.email, code, newPassword: newPassword() });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ error: 'code_invalid' });
  });

  test('an unregistered email is answered alike but mailed nothing', async () => {
    const email = `nobody_${crypto.randomUUID().slice(0, 8)}@example.com`;
    expect((await sendCode(ctx, email)).status).toBe(204);
    await mailer.expectNoMailTo(email);

    const res = await reset(ctx, { email, code: '000000', newPassword: newPassword() });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'code_invalid' });
  });

  test('members without an email cannot be reset through their placeholder address', async () => {
    const member = await signUpHousehold(ctx);
    const [row] = await ctx.database.db.select({ email: user.email }).from(user).where(eq(user.id, member.userId));
    expect((await sendCode(ctx, row!.email)).status).toBe(204);
    await mailer.expectNoMailTo(row!.email);
  });

  test('the new password follows the password rules and a refused one leaves the code usable', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    await sendCode(ctx, member.email);
    const code = await mailer.codeFor(member.email);

    expect((await reset(ctx, { email: member.email, code, newPassword: 'short' })).status).toBe(400);
    expect((await reset(ctx, { email: member.email, code, newPassword: 'x'.repeat(129) })).status).toBe(400);
    expect(await signInStatus(ctx, member.username, member.password)).toBe(200);

    expect((await reset(ctx, { email: member.email, code, newPassword: newPassword() })).status).toBe(204);
  });

  test('a code is not interchangeable with one for another purpose', async () => {
    const start = freezeClock();
    const member = await signUpWithEmail(ctx, mailer);
    advance(start, minutes(1));
    // The address is registered, so the register code is stored but never mailed; only the reset code arrives.
    await ctx.app.request('/api/email-codes', jsonRequest('POST', { email: member.email, purpose: 'register' }));
    await sendCode(ctx, member.email);
    const code = await mailer.codeFor(member.email);
    const visitor = { username: `x_${crypto.randomUUID().slice(0, 8)}`, password: 'password-x', name: 'X' };
    const signup = await ctx.app.request('/api/signup', jsonRequest('POST', { ...visitor, email: member.email, code }));
    expect(await signup.json()).toEqual({ error: 'code_invalid' });
    expect((await reset(ctx, { email: member.email, code, newPassword: newPassword() })).status).toBe(204);
  });

  test('five wrong tries use the code up', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    await sendCode(ctx, member.email);
    const code = await mailer.codeFor(member.email);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const res = await reset(ctx, { email: member.email, code: wrong, newPassword: newPassword() });
      expect(await res.json()).toEqual({ error: 'code_invalid' });
    }
    const exhausted = await reset(ctx, { email: member.email, code, newPassword: newPassword() });
    expect(exhausted.status).toBe(422);
    expect(await exhausted.json()).toEqual({ error: 'code_attempts_exceeded' });
    expect(await signInStatus(ctx, member.username, member.password)).toBe(200);
  });

  test('a code expires after ten minutes', async () => {
    const start = freezeClock();
    const member = await signUpWithEmail(ctx, mailer);
    await sendCode(ctx, member.email);
    const code = await mailer.codeFor(member.email);

    advance(start, minutes(10));
    const res = await reset(ctx, { email: member.email, code, newPassword: newPassword() });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'code_expired' });
  });

  test('codes are rate-limited whether or not the address is registered', async () => {
    const start = freezeClock();
    const member = await signUpWithEmail(ctx, mailer);
    const stranger = `nobody_${crypto.randomUUID().slice(0, 8)}@example.com`;

    for (const email of [member.email, stranger]) {
      expect((await sendCode(ctx, email)).status).toBe(204);
      advance(start, 20_000);
      const throttled = await sendCode(ctx, email);
      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toBe('40');
      expect(await throttled.json()).toEqual({ error: 'code_rate_limited', retryAfter: 40 });
      setSystemTime(start);
    }

    for (let i = 1; i < 5; i++) {
      advance(start, minutes(i * 2));
      expect((await sendCode(ctx, stranger)).status).toBe(204);
    }
    advance(start, minutes(30));
    expect(await (await sendCode(ctx, stranger)).json()).toEqual({ error: 'code_rate_limited', retryAfter: 30 * 60 });
  });
});

describe('password reset and MCP clients', () => {
  const mailer = fakeMailer();
  const ctx = useTestApp({ mailer, signupOpen: true, listen: true });

  const listTools = (accessToken: string) =>
    fetch(new URL('/mcp', ctx.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

  test('a reset revokes the MCP clients authorized before it, tokens and all', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    const { accessToken, refreshToken } = await authorizeAsClaude(ctx.baseUrl, member, {
      scope: 'stockup:read offline_access',
    });
    expect((await listTools(accessToken)).status).toBe(200);
    expect(refreshToken).toBeTruthy();

    await sendCode(ctx, member.email);
    const password = newPassword();
    const code = await mailer.codeFor(member.email);
    expect((await reset(ctx, { email: member.email, code, newPassword: password })).status).toBe(204);

    expect((await listTools(accessToken)).status).toBe(401);
    const refreshed = await fetch(new URL('/api/auth/oauth2/token', ctx.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken!, client_id: CLAUDE_CLIENT_ID }),
    });
    expect(refreshed.ok).toBe(false);

    // Token issue times are in whole seconds, and a grant newer than the token is what rejects it.
    await Bun.sleep(1000);
    const renewed = await authorizeAsClaude(ctx.baseUrl, { ...member, password });
    expect((await listTools(renewed.accessToken)).status).toBe(200);
    expect((await listTools(accessToken)).status).toBe(401);
  });
});
