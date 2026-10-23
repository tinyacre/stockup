import { describe, expect, test } from 'bun:test';
import {
  jsonRequest,
  recordersOf,
  recordPrice,
  requestAs,
  signIn,
  signUpHousehold,
  useTestApp,
} from './support/harness';

const ctx = useTestApp();

describe('display name', () => {
  test('a member renames themselves', async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request('/api/me', jsonRequest('PATCH', { name: '  小明  ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: member.userId, name: '小明' } });
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { name: '小明' } });
  });

  test("Better Auth's own profile endpoint is closed, so names follow StockUp's rules and usernames stay fixed", async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request('/api/auth/update-user', jsonRequest('POST', { name: '', username: 'renamed' }));
    expect(res.status).toBe(404);
    expect(await (await member.request('/api/me')).json()).toMatchObject({
      user: { username: member.username, name: member.name },
    });
  });

  test('rejects an empty or overlong name', async () => {
    const member = await signUpHousehold(ctx);
    for (const name of ['   ', 'x'.repeat(51)]) {
      expect((await member.request('/api/me', jsonRequest('PATCH', { name }))).status).toBe(400);
    }
  });

  test('price records show the new name of the member who entered them', async () => {
    const member = await signUpHousehold(ctx);
    const { productId } = await recordPrice(member);
    await member.request('/api/me', jsonRequest('PATCH', { name: '新名字' }));

    expect(await recordersOf(member, productId)).toEqual([{ id: member.userId, name: '新名字' }]);
  });
});

describe('theme', () => {
  test('a new account uses the tool theme', async () => {
    const member = await signUpHousehold(ctx);
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { theme: 'tool' } });
  });

  test('a member switches theme and every session of the account sees it', async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request('/api/me', jsonRequest('PATCH', { theme: 'price-tag' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { name: member.name, theme: 'price-tag' } });

    const phone = await signIn(ctx, member.username, member.password);
    expect(await (await requestAs(ctx, phone, '/api/me')).json()).toMatchObject({ user: { theme: 'price-tag' } });
  });

  test('changing the theme keeps the name, and renaming keeps the theme', async () => {
    const member = await signUpHousehold(ctx);
    await member.request('/api/me', jsonRequest('PATCH', { theme: 'price-tag' }));
    await member.request('/api/me', jsonRequest('PATCH', { name: '新名字' }));
    expect(await (await member.request('/api/me')).json()).toMatchObject({
      user: { name: '新名字', theme: 'price-tag' },
    });
  });

  test('rejects an unknown theme', async () => {
    const member = await signUpHousehold(ctx);
    expect((await member.request('/api/me', jsonRequest('PATCH', { theme: 'dark' }))).status).toBe(400);
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { theme: 'tool' } });
  });

  test("a member's theme does not change anyone else's", async () => {
    const member = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    await member.request('/api/me', jsonRequest('PATCH', { theme: 'price-tag' }));
    expect(await (await other.request('/api/me')).json()).toMatchObject({ user: { theme: 'tool' } });
  });

  test('Better Auth refuses to set the theme through its own endpoints', async () => {
    const member = await signUpHousehold(ctx);
    await member.request('/api/auth/update-user', jsonRequest('POST', { theme: 'price-tag' }));
    expect(await (await member.request('/api/me')).json()).toMatchObject({ user: { theme: 'tool' } });
  });
});

describe('password', () => {
  test('a member changes their password and signs in with the new one', async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request(
      '/api/me/password',
      jsonRequest('POST', { currentPassword: member.password, newPassword: 'a-brand-new-password' }),
    );
    expect(res.status).toBe(204);

    expect((await member.request('/api/me')).status).toBe(200);
    await signIn(ctx, member.username, 'a-brand-new-password');
    await expect(signIn(ctx, member.username, member.password)).rejects.toThrow();
  });

  test('requires the current password', async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request(
      '/api/me/password',
      jsonRequest('POST', { currentPassword: 'not-the-password', newPassword: 'a-brand-new-password' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'wrong_password' });
    await signIn(ctx, member.username, member.password);
  });

  test('rejects a new password that does not meet the sign-in rules', async () => {
    const member = await signUpHousehold(ctx);
    const res = await member.request(
      '/api/me/password',
      jsonRequest('POST', { currentPassword: member.password, newPassword: 'short' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('signing out everywhere', () => {
  test("ends the member's sessions on other devices and keeps this one", async () => {
    const member = await signUpHousehold(ctx);
    const phone = await signIn(ctx, member.username, member.password);
    const other = await signUpHousehold(ctx);

    expect((await member.request('/api/me/sign-out-others', { method: 'POST' })).status).toBe(204);

    expect((await requestAs(ctx, phone, '/api/me')).status).toBe(401);
    expect((await member.request('/api/me')).status).toBe(200);
    expect((await other.request('/api/me')).status).toBe(200);
  });

  test('requires a signed-in member', async () => {
    expect((await ctx.app.request('/api/me/sign-out-others', { method: 'POST' })).status).toBe(401);
  });
});
