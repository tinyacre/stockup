import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { fakeMailer } from './support/fake-mailer';
import {
  jsonRequest,
  requestAs,
  signIn,
  signUpHousehold,
  signUpWithEmail,
  useTestApp,
  type SignedInMember,
} from './support/harness';

function newEmail() {
  return `new_${crypto.randomUUID().slice(0, 8)}@example.com`;
}

function sendCode(m: SignedInMember, email: string) {
  return m.request('/api/email-codes', jsonRequest('POST', { email, purpose: 'change-email' }));
}

function changeEmail(m: SignedInMember, email: string, code: string) {
  return m.request('/api/me/email', jsonRequest('POST', { email, code }));
}

afterEach(() => {
  setSystemTime();
});

describe('an instance that cannot mail', () => {
  const ctx = useTestApp();

  test('refuses to send change-email codes or change the email', async () => {
    const member = await signUpHousehold(ctx);
    const sent = await sendCode(member, newEmail());
    expect(sent.status).toBe(403);
    expect(await sent.json()).toEqual({ error: 'email_unavailable' });
    const changed = await changeEmail(member, newEmail(), '123456');
    expect(changed.status).toBe(403);
    expect(await changed.json()).toEqual({ error: 'email_unavailable' });
  });
});

describe('changing the email', () => {
  const mailer = fakeMailer();
  const ctx = useTestApp({ mailer, signupOpen: true });

  test('mails the code to the new address only, and the member then signs in with it', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    const mailedBefore = mailer.messages.filter((m) => m.to === member.email).length;
    const email = newEmail();

    expect((await sendCode(member, email.toUpperCase())).status).toBe(204);
    const code = await mailer.codeFor(email);
    expect(mailer.messages.at(-1)!.text).toContain('更换邮箱验证码');
    expect(mailer.messages.filter((m) => m.to === member.email).length).toBe(mailedBefore);

    const res = await changeEmail(member, email, code);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: member.userId, email } });
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { email } });

    const signedIn = await signIn(ctx, email, member.password);
    expect(await (await requestAs(ctx, signedIn, '/api/me')).json()).toMatchObject({ user: { id: member.userId } });
    const old = await ctx.app.request(
      '/api/auth/sign-in/username',
      jsonRequest('POST', { username: member.email, password: member.password }),
    );
    expect(old.status).toBe(401);
  });

  test('a member without an email adds one through the same flow', async () => {
    const member = await signUpHousehold(ctx);
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { email: null } });
    const email = newEmail();
    await sendCode(member, email);
    expect((await changeEmail(member, email, await mailer.codeFor(email))).status).toBe(200);

    const signedIn = await signIn(ctx, email, member.password);
    expect(await (await requestAs(ctx, signedIn, '/api/me')).json()).toMatchObject({
      user: { id: member.userId, email },
    });
  });

  test("another account's email is reported taken only once the code checks out", async () => {
    const member = await signUpHousehold(ctx);
    const other = await signUpWithEmail(ctx, mailer);

    expect((await sendCode(member, other.email)).status).toBe(204);
    const code = await mailer.codeFor(other.email);
    const wrong = await changeEmail(member, other.email, code === '000000' ? '111111' : '000000');
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toEqual({ error: 'code_invalid' });

    const taken = await changeEmail(member, other.email, code);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'email_taken' });
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { email: null } });
    expect(await (await other.request('/api/me')).json()).toMatchObject({ user: { email: other.email } });
  });

  test('re-confirming the current email keeps it', async () => {
    const member = await signUpWithEmail(ctx, mailer);
    // The register code was sent moments ago; the clock moves past the resend cooldown.
    setSystemTime(new Date(Date.now() + 61_000));
    await sendCode(member, member.email);
    const res = await changeEmail(member, member.email, await mailer.codeFor(member.email));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { email: member.email } });
  });

  test('a code mailed for another purpose does not change the email', async () => {
    const member = await signUpHousehold(ctx);
    const email = newEmail();
    await ctx.app.request('/api/email-codes', jsonRequest('POST', { email, purpose: 'register' }));
    const res = await changeEmail(member, email, await mailer.codeFor(email));
    expect(res.status).toBe(422);
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { email: null } });
  });

  test('a code changes the email only once', async () => {
    const member = await signUpHousehold(ctx);
    const email = newEmail();
    await sendCode(member, email);
    const code = await mailer.codeFor(email);
    expect((await changeEmail(member, email, code)).status).toBe(200);
    const again = await changeEmail(await signUpHousehold(ctx), email, code);
    expect(again.status).toBe(422);
  });

  test('requires a signed-in member', async () => {
    const email = newEmail();
    const sent = await ctx.app.request('/api/email-codes', jsonRequest('POST', { email, purpose: 'change-email' }));
    expect(sent.status).toBe(401);
    await mailer.expectNoMailTo(email);
    expect((await ctx.app.request('/api/me/email', jsonRequest('POST', { email, code: '123456' }))).status).toBe(401);
  });

  test("Better Auth's own email change is closed", async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request('/api/auth/change-email', jsonRequest('POST', { newEmail: newEmail() }));
    expect(res.status).toBe(404);
  });
});
