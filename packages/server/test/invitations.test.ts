import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { invitation } from '../src/db/schema';
import {
  joinHousehold,
  jsonRequest,
  requestAs,
  sessionCookie,
  signIn,
  signUpHousehold,
  useTestApp,
  type SignedInMember,
} from './support/harness';

const ctx = useTestApp();

interface Invitation {
  id: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string } | null;
}

function newcomer() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return { username: `newcomer_${suffix}`, password: `password-${suffix}`, name: `Newcomer ${suffix}` };
}

async function invite(admin: SignedInMember, expiresInDays = 7) {
  const res = await admin.request('/api/invitations', jsonRequest('POST', { expiresInDays }));
  expect(res.status).toBe(201);
  return (await res.json()) as Invitation;
}

function join(id: string, account = newcomer()) {
  return ctx.app.request(`/api/join/${id}`, jsonRequest('POST', account));
}

describe('generating invitations', () => {
  test('a household admin invites with an expiry', async () => {
    const admin = await signUpHousehold(ctx);
    const before = Date.now();
    const created = await invite(admin, 3);

    expect(created).toMatchObject({ status: 'pending', invitedBy: { id: admin.userId } });
    const expiresIn = new Date(created.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan(3 * 86_400_000 - 60_000);
    expect(expiresIn).toBeLessThan(3 * 86_400_000 + 60_000);

    const list = await admin.request('/api/invitations');
    expect(await list.json()).toEqual([created]);
  });

  test('rejects an expiry outside one to thirty days', async () => {
    const admin = await signUpHousehold(ctx);
    for (const expiresInDays of [0, 31, 1.5]) {
      const res = await admin.request('/api/invitations', jsonRequest('POST', { expiresInDays }));
      expect(res.status).toBe(400);
    }
  });

  test('members who are not household admins cannot invite, list or revoke', async () => {
    const admin = await signUpHousehold(ctx);
    const pending = await invite(admin);
    const member = await joinHousehold(ctx, admin);

    expect((await member.request('/api/invitations', jsonRequest('POST', { expiresInDays: 7 }))).status).toBe(403);
    expect((await member.request('/api/invitations')).status).toBe(403);
    const revoke = await member.request(`/api/invitations/${pending.id}/revoke`, { method: 'POST' });
    expect(revoke.status).toBe(403);
    expect(await revoke.json()).toEqual({ error: 'forbidden' });

    const [stillPending] = ((await (await admin.request('/api/invitations')).json()) as Invitation[]).filter(
      (i) => i.id === pending.id,
    );
    expect(stillPending?.status).toBe('pending');
  });

  test('requires a signed-in member', async () => {
    expect((await ctx.app.request('/api/invitations', jsonRequest('POST', { expiresInDays: 7 }))).status).toBe(401);
  });
});

describe('joining through an invitation', () => {
  test('describes the household it invites to', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    const res = await ctx.app.request(`/api/join/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      householdName: `Household ${admin.username.slice('member_'.length)}`,
      invitedBy: `Member ${admin.username.slice('member_'.length)}`,
    });
  });

  test('the invitee registers, is signed in and becomes a member of the household', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    const account = newcomer();

    const res = await join(id, account);
    expect(res.status).toBe(201);
    const me = await requestAs(ctx, sessionCookie(res), '/api/me');
    expect(await me.json()).toMatchObject({
      user: { username: account.username, name: account.name, isInstanceAdmin: false },
      household: { id: admin.householdId, role: 'member' },
    });

    const cookie = await signIn(ctx, account.username, account.password);
    expect((await requestAs(ctx, cookie, '/api/me')).status).toBe(200);

    const [used] = (await (await admin.request('/api/invitations')).json()) as Invitation[];
    expect(used?.status).toBe('accepted');
  });

  test('an invitation admits one person', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    expect((await join(id)).status).toBe(201);

    const again = await join(id);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: 'invitation_used' });
    expect((await ctx.app.request(`/api/join/${id}`)).status).toBe(410);
  });

  test('exactly one of two simultaneous invitees joins', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    const results = await Promise.all([join(id), join(id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
  });

  test('a revoked invitation can no longer be used', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);

    const revoke = await admin.request(`/api/invitations/${id}/revoke`, { method: 'POST' });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ id, status: 'revoked' });

    const look = await ctx.app.request(`/api/join/${id}`);
    expect(look.status).toBe(410);
    expect(await look.json()).toEqual({ error: 'invitation_revoked' });
    const res = await join(id);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'invitation_revoked' });
  });

  test('a used invitation cannot be revoked', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    await join(id);
    const revoke = await admin.request(`/api/invitations/${id}/revoke`, { method: 'POST' });
    expect(revoke.status).toBe(409);
    expect(await revoke.json()).toEqual({ error: 'invitation_used' });
  });

  test('an expired invitation can no longer be used', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    await ctx.database.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, id));

    const res = await join(id);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'invitation_expired' });
    const [listed] = (await (await admin.request('/api/invitations')).json()) as Invitation[];
    expect(listed?.status).toBe('expired');
  });

  test('an unknown invitation is not found', async () => {
    expect((await ctx.app.request(`/api/join/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await join(crypto.randomUUID())).status).toBe(404);
  });

  test('rejects a username that is already taken and leaves the invitation usable', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    const res = await join(id, { ...newcomer(), username: admin.username.toUpperCase() });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'username_taken' });
    expect((await join(id)).status).toBe(201);
  });

  test('rejects an account that does not meet the sign-in rules', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    expect((await join(id, { ...newcomer(), password: 'short' })).status).toBe(400);
    expect((await join(id, { ...newcomer(), username: 'no spaces' })).status).toBe(400);
  });
});

describe('one household per member', () => {
  test("a member of one household cannot join through another household's invitation", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const { id } = await invite(bob);

    const res = await join(id, { username: alice.username, password: alice.password, name: 'Alice' });
    expect(res.status).toBe(409);
    const me = await alice.request('/api/me');
    expect(await me.json()).toMatchObject({ household: { id: alice.householdId } });
  });

  test("a member cannot revoke another household's invitation", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const { id } = await invite(bob);

    expect((await alice.request(`/api/invitations/${id}/revoke`, { method: 'POST' })).status).toBe(404);
    expect(await (await alice.request('/api/invitations')).json()).toEqual([]);
    expect((await ctx.app.request(`/api/join/${id}`)).status).toBe(200);
  });

  test('members invited into two households each see only their own household', async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const carol = await joinHousehold(ctx, alice);
    const dave = await joinHousehold(ctx, bob);

    const name = `Shared name ${crypto.randomUUID().slice(0, 6)}`;
    const created = await carol.request('/api/channels', jsonRequest('POST', { name }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const seenBy = async (m: SignedInMember) =>
      ((await (await m.request('/api/channels')).json()) as { id: string }[]).map((c) => c.id);
    expect(await seenBy(alice)).toContain(id);
    expect(await seenBy(dave)).not.toContain(id);
    expect(await seenBy(bob)).not.toContain(id);
    expect((await dave.request(`/api/channels/${id}`)).status).toBe(404);
    expect(await (await dave.request('/api/me')).json()).toMatchObject({
      household: { id: bob.householdId, role: 'member' },
    });
  });
});
