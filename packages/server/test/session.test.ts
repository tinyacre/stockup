import { describe, expect, test } from 'bun:test';
import { jsonRequest, requestAs, signIn, signUpHousehold, useTestApp } from './support/harness';

const ctx = useTestApp();

describe('signing in and out', () => {
  test('a member signs in with username and password', async () => {
    const member = await signUpHousehold(ctx);
    const cookie = await signIn(ctx, member.username.toUpperCase(), member.password);

    const me = await requestAs(ctx, cookie, '/api/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { id: member.userId, username: member.username, isInstanceAdmin: false },
      household: { id: member.householdId, role: 'admin' },
    });
  });

  test('a wrong password is refused', async () => {
    const member = await signUpHousehold(ctx);
    const res = await ctx.app.request(
      '/api/auth/sign-in/username',
      jsonRequest('POST', { username: member.username, password: 'not-the-password' }),
    );
    expect(res.status).toBe(401);
  });

  test('signing out ends the session', async () => {
    const member = await signUpHousehold(ctx);
    expect((await member.request('/api/auth/sign-out', { method: 'POST' })).status).toBe(200);
    expect((await member.request('/api/me')).status).toBe(401);
  });

  test('anonymous requests are unauthenticated', async () => {
    const res = await ctx.app.request('/api/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });
});
