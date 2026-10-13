import { describe, expect, test } from 'bun:test';
import { jsonRequest, requestAs, sessionCookie, signIn, useTestApp } from './support/harness';

const ctx = useTestApp();

const founder = {
  username: 'Founder',
  password: 'correct horse battery',
  name: '爸爸',
  householdName: '我们家',
};

describe('first member onboarding', () => {
  test('an empty instance asks for setup', async () => {
    const res = await ctx.app.request('/api/setup');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needsSetup: true });
  });

  test('rejects an incomplete founder', async () => {
    const res = await ctx.app.request('/api/setup', jsonRequest('POST', { ...founder, password: 'short' }));
    expect(res.status).toBe(400);
    expect(await (await ctx.app.request('/api/setup')).json()).toEqual({ needsSetup: true });
  });

  test('exactly one of two simultaneous founders wins', async () => {
    const [a, b] = await Promise.all([
      ctx.app.request('/api/setup', jsonRequest('POST', founder)),
      ctx.app.request('/api/setup', jsonRequest('POST', { ...founder, username: 'intruder' })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner = a.status === 201 ? a : b;

    const me = await requestAs(ctx, sessionCookie(winner), '/api/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { username: 'founder', name: '爸爸', isInstanceAdmin: true },
      household: { name: '我们家', role: 'admin' },
    });
  });

  test('setup is closed once the instance has a member', async () => {
    expect(await (await ctx.app.request('/api/setup')).json()).toEqual({ needsSetup: false });
    const res = await ctx.app.request('/api/setup', jsonRequest('POST', { ...founder, username: 'latecomer' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_set_up' });
  });

  test('open registration is closed', async () => {
    const res = await ctx.app.request(
      '/api/auth/sign-up/email',
      jsonRequest('POST', {
        email: 'stranger@example.com',
        password: 'stranger-password',
        name: 'Stranger',
        username: 'stranger',
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    await expect(signIn(ctx, 'stranger', 'stranger-password')).rejects.toThrow();
  });
});
