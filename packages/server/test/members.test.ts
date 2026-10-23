import { describe, expect, test } from 'bun:test';
import {
  joinHousehold,
  recordersOf,
  recordPrice,
  signIn,
  signUpHousehold,
  useTestApp,
  type SignedInMember,
} from './support/harness';

const ctx = useTestApp();

interface Member {
  id: string;
  name: string;
  username: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

async function membersSeenBy(m: SignedInMember) {
  const res = await m.request('/api/members');
  expect(res.status).toBe(200);
  return (await res.json()) as Member[];
}

function remove(admin: SignedInMember, userId: string) {
  return admin.request(`/api/members/${userId}`, { method: 'DELETE' });
}

function makeAdmin(admin: SignedInMember, userId: string) {
  return admin.request(`/api/members/${userId}/make-admin`, { method: 'POST' });
}

describe('listing members', () => {
  test('a household admin sees every member with their role, admin first', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);

    expect(await membersSeenBy(admin)).toEqual([
      expect.objectContaining({ id: admin.userId, username: admin.username, role: 'admin' }),
      expect.objectContaining({ id: member.userId, username: member.username, role: 'member' }),
    ]);
  });

  test("another household's members are not listed", async () => {
    const alice = await signUpHousehold(ctx);
    await joinHousehold(ctx, await signUpHousehold(ctx));
    expect((await membersSeenBy(alice)).map((m) => m.id)).toEqual([alice.userId]);
  });
});

describe('removing a member', () => {
  test('the removed member loses access at once, even on a signed-in device', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);
    expect((await member.request('/api/channels')).status).toBe(200);

    expect((await remove(admin, member.userId)).status).toBe(204);

    expect((await member.request('/api/channels')).status).toBe(401);
    expect((await membersSeenBy(admin)).map((m) => m.id)).toEqual([admin.userId]);
    const again = await signIn(ctx, member.username, member.password);
    const me = await ctx.app.request('/api/me', { headers: { cookie: again } });
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({ error: 'no_household' });
  });

  test('price records keep the name of a removed member', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);
    const { productId } = await recordPrice(member);
    await remove(admin, member.userId);

    expect(await recordersOf(admin, productId)).toEqual([{ id: member.userId, name: member.name }]);
  });

  test('the household admin cannot remove themselves', async () => {
    const admin = await signUpHousehold(ctx);
    const res = await remove(admin, admin.userId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'cannot_remove_self' });
  });

  test('a member of another household is not found', async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const dave = await joinHousehold(ctx, bob);
    expect((await remove(alice, dave.userId)).status).toBe(404);
    expect((await dave.request('/api/me')).status).toBe(200);
  });
});

describe('handing over the household admin role', () => {
  test('the chosen member becomes admin and the previous admin a member', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);

    expect((await makeAdmin(admin, member.userId)).status).toBe(204);

    expect(await (await member.request('/api/me')).json()).toMatchObject({ household: { role: 'admin' } });
    expect(await (await admin.request('/api/me')).json()).toMatchObject({ household: { role: 'member' } });
    expect((await admin.request('/api/invitations')).status).toBe(403);
    expect((await member.request('/api/invitations')).status).toBe(200);
  });

  test('the admin cannot hand the role to themselves', async () => {
    const admin = await signUpHousehold(ctx);
    const res = await makeAdmin(admin, admin.userId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_admin' });
  });

  test('a member of another household is not found', async () => {
    const alice = await signUpHousehold(ctx);
    const dave = await joinHousehold(ctx, await signUpHousehold(ctx));
    expect((await makeAdmin(alice, dave.userId)).status).toBe(404);
    expect(await (await dave.request('/api/me')).json()).toMatchObject({ household: { role: 'member' } });
  });

  test('two simultaneous handovers leave exactly one admin', async () => {
    const admin = await signUpHousehold(ctx);
    const carol = await joinHousehold(ctx, admin);
    const dave = await joinHousehold(ctx, admin);

    const results = await Promise.all([makeAdmin(admin, carol.userId), makeAdmin(admin, dave.userId)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 403]);
    const roles = await Promise.all([admin, carol, dave].map(async (m) => (await m.request('/api/me')).json()));
    expect(roles.filter((r) => (r as { household: { role: string } }).household.role === 'admin')).toHaveLength(1);
  });
});

describe('role permissions', () => {
  test('members who are not household admins cannot list, remove or hand over', async () => {
    const admin = await signUpHousehold(ctx);
    const carol = await joinHousehold(ctx, admin);
    const dave = await joinHousehold(ctx, admin);

    expect((await carol.request('/api/members')).status).toBe(403);
    const removal = await remove(carol, dave.userId);
    expect(removal.status).toBe(403);
    expect(await removal.json()).toEqual({ error: 'forbidden' });
    expect((await makeAdmin(carol, carol.userId)).status).toBe(403);
    expect((await makeAdmin(carol, dave.userId)).status).toBe(403);

    expect((await dave.request('/api/me')).status).toBe(200);
    expect(await (await admin.request('/api/me')).json()).toMatchObject({ household: { role: 'admin' } });
  });

  test('requires a signed-in member', async () => {
    expect((await ctx.app.request('/api/members')).status).toBe(401);
  });
});
