import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { createApp } from '../src/app';
import { emailCode } from '../src/db/schema';
import { advance, freezeClock, minutes } from './support/clock';
import { fakeMailer } from './support/fake-mailer';
import {
  joinHousehold,
  jsonRequest,
  requestAs,
  sessionCookie,
  signIn,
  signUpHousehold,
  signUpWithEmail,
  useTestApp,
  type TestContext,
} from './support/harness';

function newVisitor() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    email: `visitor_${suffix}@example.com`,
    username: `visitor_${suffix}`,
    password: `password-${suffix}`,
    name: `访客 ${suffix}`,
  };
}

function sendCode(ctx: TestContext, email: string) {
  return ctx.app.request('/api/email-codes', jsonRequest('POST', { email, purpose: 'register' }));
}

function submit(ctx: TestContext, visitor: ReturnType<typeof newVisitor>, code: string) {
  return ctx.app.request('/api/signup', jsonRequest('POST', { ...visitor, code }));
}

afterEach(() => {
  setSystemTime();
});

describe('an instance with signup closed and no mail', () => {
  const ctx = useTestApp();

  test('offers neither signup nor email', async () => {
    const res = await ctx.app.request('/api/capabilities');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signup: false, email: false, turnstileSiteKey: null });
  });

  test('refuses to send codes or register', async () => {
    const visitor = newVisitor();
    expect(await (await sendCode(ctx, visitor.email)).json()).toEqual({ error: 'email_unavailable' });
    const res = await submit(ctx, visitor, '123456');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'signup_closed' });
  });

  test("leaves Better Auth's own email verification closed", async () => {
    for (const path of ['/api/auth/send-verification-email', '/api/auth/verify-email']) {
      expect((await ctx.app.request(path, jsonRequest('POST', { email: 'a@example.com' }))).status).toBe(404);
    }
  });

  test('reports members without an email as having none', async () => {
    const member = await signUpHousehold(ctx);
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { email: null } });
  });
});

describe('an instance that can mail but keeps signup closed', () => {
  const mailer = fakeMailer();
  const ctx = useTestApp({ mailer });

  test('offers email but not signup', async () => {
    expect(await (await ctx.app.request('/api/capabilities')).json()).toEqual({
      signup: false,
      email: true,
      turnstileSiteKey: null,
    });
  });

  test('sends no signup codes', async () => {
    const visitor = newVisitor();
    const res = await sendCode(ctx, visitor.email);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'signup_closed' });
    await mailer.expectNoMailTo(visitor.email);
    expect((await submit(ctx, visitor, '123456')).status).toBe(403);
  });
});

describe('open signup', () => {
  const mailer = fakeMailer();
  const ctx = useTestApp({ mailer, signupOpen: true });

  test('is advertised', async () => {
    expect(await (await ctx.app.request('/api/capabilities')).json()).toEqual({
      signup: true,
      email: true,
      turnstileSiteKey: null,
    });
  });

  test('cannot be opened without a mailer', () => {
    expect(() => createApp({ db: ctx.database.db, auth: ctx.auth, evidence: {} as never, signupOpen: true })).toThrow(
      'mailer',
    );
  });

  test('a visitor registers with an emailed code and administers a household of their own', async () => {
    const visitor = { ...newVisitor(), username: `Visitor_${crypto.randomUUID().slice(0, 8)}` };
    const sent = await sendCode(ctx, visitor.email.toUpperCase());
    expect(sent.status).toBe(204);
    const code = await mailer.codeFor(visitor.email);
    const mail = mailer.messages.at(-1)!;
    expect(mail.subject).toBe(`StockUp 验证码 ${code}`);
    expect(mail.text).toContain('注册验证码');
    expect(mail.text).toContain('10 分钟内有效');
    expect(mail.html).toContain(code);

    const res = await submit(ctx, visitor, code);
    expect(res.status).toBe(201);
    const { userId, householdId } = (await res.json()) as { userId: string; householdId: string };

    const me = await requestAs(ctx, sessionCookie(res), '/api/me');
    expect(await me.json()).toEqual({
      user: {
        id: userId,
        username: visitor.username.toLowerCase(),
        name: visitor.name,
        email: visitor.email,
        theme: 'tool',
        isInstanceAdmin: false,
      },
      household: { id: householdId, name: `${visitor.username} 的家`, role: 'admin' },
    });
  });

  test('the new member signs in with either the username or the email', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    for (const login of [member.username, member.email, member.email.toUpperCase()]) {
      const me = await requestAs(ctx, await signIn(ctx, login, member.password), '/api/me');
      expect(await me.json()).toMatchObject({ user: { id: member.userId } });
    }
    const wrong = await ctx.app.request(
      '/api/auth/sign-in/username',
      jsonRequest('POST', { username: member.email, password: 'not-the-password' }),
    );
    expect(wrong.status).toBe(401);
  });

  test('a registered email is answered alike but mailed nothing, and still rate-limited', async () => {
    const start = freezeClock();
    const member = await signUpWithEmail(ctx, mailer);
    const before = mailer.messages.length;
    advance(start, minutes(1));
    expect((await sendCode(ctx, member.email)).status).toBe(204);
    await Bun.sleep(200);
    expect(mailer.messages.length).toBe(before);

    const again = await sendCode(ctx, member.email);
    expect(again.status).toBe(429);

    // No code was mailed, so none can be redeemed: the address does not surface as taken.
    const res = await submit(ctx, { ...newVisitor(), email: member.email }, '000000');
    expect(await res.json()).toEqual({ error: 'code_invalid' });
  });

  test('a registered and a fresh address run out of attempts and expire alike', async () => {
    const start = freezeClock();
    const member = await signUpWithEmail(ctx, mailer);
    const visitor = newVisitor();
    const addresses = [member.email, visitor.email];
    const sendAll = async () => {
      for (const email of addresses) expect((await sendCode(ctx, email)).status).toBe(204);
    };
    advance(start, minutes(1));
    await sendAll();
    const wrong = (await mailer.codeFor(visitor.email)) === '000000' ? '111111' : '000000';
    const errorFor = async (email: string) => (await submit(ctx, { ...newVisitor(), email }, wrong)).json();

    for (const email of addresses) {
      const errors = [];
      for (let i = 0; i < 6; i++) errors.push(await errorFor(email));
      expect(errors).toEqual([...Array(5).fill({ error: 'code_invalid' }), { error: 'code_attempts_exceeded' }]);
    }

    advance(start, minutes(2));
    await sendAll();
    advance(start, minutes(12));
    for (const email of addresses) expect(await errorFor(email)).toEqual({ error: 'code_expired' });
  });

  test('rejects an address that is not an email', async () => {
    expect((await sendCode(ctx, 'not-an-email')).status).toBe(400);
  });

  test('a code registers only once', async () => {
    const visitor = newVisitor();
    await sendCode(ctx, visitor.email);
    const code = await mailer.codeFor(visitor.email);
    expect((await submit(ctx, visitor, code)).status).toBe(201);
    const again = await submit(ctx, { ...newVisitor(), email: visitor.email }, code);
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ error: 'code_invalid' });
  });

  test('a taken username leaves the code usable', async () => {
    const existing = await signUpHousehold(ctx);
    const visitor = newVisitor();
    await sendCode(ctx, visitor.email);
    const code = await mailer.codeFor(visitor.email);

    const taken = await submit(ctx, { ...visitor, username: existing.username }, code);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'username_taken' });
    expect((await submit(ctx, visitor, code)).status).toBe(201);
  });

  test('an address another account takes before the code is redeemed is reported taken', async () => {
    const start = freezeClock();
    const visitor = newVisitor();
    expect((await sendCode(ctx, visitor.email)).status).toBe(204);
    const code = await mailer.codeFor(visitor.email);

    const other = await signUpWithEmail(ctx, mailer);
    advance(start, minutes(1));
    const sent = await other.request(
      '/api/email-codes',
      jsonRequest('POST', { email: visitor.email, purpose: 'change-email' }),
    );
    expect(sent.status).toBe(204);
    const changeCode = await mailer.codeFor(visitor.email);
    const changed = await other.request(
      '/api/me/email',
      jsonRequest('POST', { email: visitor.email, code: changeCode }),
    );
    expect(changed.status).toBe(200);

    const res = await submit(ctx, visitor, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_taken' });
  });

  test('a wrong code is refused, and five wrong tries use the code up', async () => {
    const visitor = newVisitor();
    await sendCode(ctx, visitor.email);
    const code = await mailer.codeFor(visitor.email);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const res = await submit(ctx, visitor, wrong);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'code_invalid' });
    }
    const exhausted = await submit(ctx, visitor, code);
    expect(exhausted.status).toBe(422);
    expect(await exhausted.json()).toEqual({ error: 'code_attempts_exceeded' });
  });

  test('a code expires after ten minutes', async () => {
    const start = freezeClock();
    const visitor = newVisitor();
    await sendCode(ctx, visitor.email);
    const code = await mailer.codeFor(visitor.email);

    advance(start, minutes(10));
    const res = await submit(ctx, visitor, code);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'code_expired' });
  });

  test('a new code replaces the previous one', async () => {
    const start = freezeClock();
    const visitor = newVisitor();
    await sendCode(ctx, visitor.email);
    const first = await mailer.codeFor(visitor.email);
    advance(start, minutes(1));
    expect((await sendCode(ctx, visitor.email)).status).toBe(204);
    const second = await mailer.codeFor(visitor.email);

    if (first !== second) expect(await (await submit(ctx, visitor, first)).json()).toEqual({ error: 'code_invalid' });
    expect((await submit(ctx, visitor, second)).status).toBe(201);
  });

  test('a code can be resent only after a minute, and the wait is reported', async () => {
    const start = freezeClock();
    const visitor = newVisitor();
    expect((await sendCode(ctx, visitor.email)).status).toBe(204);

    advance(start, 20_000);
    const throttled = await sendCode(ctx, visitor.email);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('retry-after')).toBe('40');
    expect(await throttled.json()).toEqual({ error: 'code_rate_limited', retryAfter: 40 });

    advance(start, minutes(1));
    expect((await sendCode(ctx, visitor.email)).status).toBe(204);
  });

  test('an address gets at most five codes in any hour', async () => {
    const start = freezeClock();
    const visitor = newVisitor();
    for (let i = 0; i < 5; i++) {
      advance(start, minutes(i * 2));
      expect((await sendCode(ctx, visitor.email)).status).toBe(204);
    }

    advance(start, minutes(30));
    const throttled = await sendCode(ctx, visitor.email);
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ error: 'code_rate_limited', retryAfter: 30 * 60 });

    // The window slides: once the first send is an hour old, one more fits, but not two.
    advance(start, minutes(60));
    expect((await sendCode(ctx, visitor.email)).status).toBe(204);
    advance(start, minutes(61));
    const next = await sendCode(ctx, visitor.email);
    expect(await next.json()).toEqual({ error: 'code_rate_limited', retryAfter: 60 });
  });

  test('stores only a keyed hash of the code', async () => {
    const visitor = newVisitor();
    await sendCode(ctx, visitor.email);
    const code = await mailer.codeFor(visitor.email);
    const rows = await ctx.database.db.select().from(emailCode);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  test('the household admin renames the household', async () => {
    const admin = await signUpWithEmail(ctx, mailer);
    const res = await admin.request('/api/household', jsonRequest('PATCH', { name: ' 我们家 ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: admin.householdId, name: '我们家' });
    expect(await (await admin.request('/api/me')).json()).toMatchObject({ household: { name: '我们家' } });

    expect((await admin.request('/api/household', jsonRequest('PATCH', { name: ' ' }))).status).toBe(400);
  });

  test('ordinary members cannot rename the household', async () => {
    const admin = await signUpWithEmail(ctx, mailer);
    const member = await joinHousehold(ctx, admin, { mailer });
    const res = await member.request('/api/household', jsonRequest('PATCH', { name: '他们家' }));
    expect(res.status).toBe(403);
  });
});
