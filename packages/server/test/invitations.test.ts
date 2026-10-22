import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { invitation } from '../src/db/schema';
import { fakeMailer } from './support/fake-mailer';
import {
  joinHousehold,
  jsonRequest,
  recordersOf,
  recordPrice,
  requestAs,
  sessionCookie,
  signIn,
  signUpHousehold,
  useTestApp,
  type SignedInMember,
  type TestContext,
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

function newcomerEmail() {
  return `newcomer_${crypto.randomUUID().slice(0, 8)}@example.com`;
}

async function invite(admin: SignedInMember, expiresInDays = 7) {
  const res = await admin.request('/api/invitations', jsonRequest('POST', { expiresInDays }));
  expect(res.status).toBe(201);
  return (await res.json()) as Invitation;
}

function join(id: string, account: Record<string, unknown> = newcomer()) {
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

describe('rejoining with an existing account', () => {
  function rejoin(cookie: string, id: string) {
    return requestAs(ctx, cookie, `/api/join/${id}/rejoin`, { method: 'POST' });
  }

  async function removed(admin: SignedInMember) {
    const member = await joinHousehold(ctx, admin);
    expect((await admin.request(`/api/members/${member.userId}`, { method: 'DELETE' })).status).toBe(204);
    return { ...member, cookie: await signIn(ctx, member.username, member.password) };
  }

  test('a removed member rejoins under their own account and keeps their price records', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);
    const { productId } = await recordPrice(member);
    await admin.request(`/api/members/${member.userId}`, { method: 'DELETE' });
    const cookie = await signIn(ctx, member.username, member.password);
    const { id } = await invite(admin);

    const res = await rejoin(cookie, id);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ userId: member.userId, householdId: admin.householdId });

    expect(await (await requestAs(ctx, cookie, '/api/me')).json()).toMatchObject({
      user: { id: member.userId, username: member.username },
      household: { id: admin.householdId, role: 'member' },
    });
    expect(await recordersOf(admin, productId)).toEqual([{ id: member.userId, name: member.name }]);
    const [used] = (await (await admin.request('/api/invitations')).json()) as Invitation[];
    expect(used?.status).toBe('accepted');
  });

  test("a removed member may join another household", async () => {
    const member = await removed(await signUpHousehold(ctx));
    const other = await signUpHousehold(ctx);
    const { id } = await invite(other);
    expect((await rejoin(member.cookie, id)).status).toBe(201);
    expect(await (await requestAs(ctx, member.cookie, '/api/me')).json()).toMatchObject({
      household: { id: other.householdId },
    });
  });

  test('a member of a household cannot use an invitation with their account', async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const { id } = await invite(bob);

    const res = await rejoin(alice.cookie, id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_member' });
    expect(await (await alice.request('/api/me')).json()).toMatchObject({ household: { id: alice.householdId } });
    expect((await ctx.app.request(`/api/join/${id}`)).status).toBe(200);
  });

  test('an unusable invitation is refused', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await removed(admin);
    const { id } = await invite(admin);
    await admin.request(`/api/invitations/${id}/revoke`, { method: 'POST' });

    const res = await rejoin(member.cookie, id);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'invitation_revoked' });
    expect((await rejoin(member.cookie, crypto.randomUUID())).status).toBe(404);
  });

  test('one invitation admits one account, even when a removed member and a newcomer race', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await removed(admin);
    const { id } = await invite(admin);
    const results = await Promise.all([rejoin(member.cookie, id), join(id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
  });

  test('an account using two invitations at once joins only one household', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await removed(admin);
    const [first, second] = [await invite(admin), await invite(await signUpHousehold(ctx))];
    const results = await Promise.all([rejoin(member.cookie, first.id), rejoin(member.cookie, second.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  test('requires a signed-in account', async () => {
    const { id } = await invite(await signUpHousehold(ctx));
    expect((await ctx.app.request(`/api/join/${id}/rejoin`, { method: 'POST' })).status).toBe(401);
  });
});

describe('an instance without mail', () => {
  test('joins without an email and refuses to send join codes', async () => {
    const admin = await signUpHousehold(ctx);
    const { id } = await invite(admin);
    const email = newcomerEmail();

    const sent = await ctx.app.request(
      '/api/email-codes',
      jsonRequest('POST', { email, purpose: 'join', invitationId: id }),
    );
    expect(sent.status).toBe(403);
    expect(await sent.json()).toEqual({ error: 'email_unavailable' });

    const res = await join(id, { ...newcomer(), email, code: '123456' });
    expect(res.status).toBe(201);
    expect(await (await requestAs(ctx, sessionCookie(res), '/api/me')).json()).toMatchObject({ user: { email: null } });
  });
});

describe('joining on an instance with mail', () => {
  afterEach(() => {
    setSystemTime();
  });

  const mailer = fakeMailer();
  const mailCtx = useTestApp({ mailer });

  function sendJoinCode(c: TestContext, email: string, invitationId?: string) {
    return c.app.request('/api/email-codes', jsonRequest('POST', { email, purpose: 'join', invitationId }));
  }

  function joinWithEmail(id: string, body: Record<string, unknown>) {
    return mailCtx.app.request(`/api/join/${id}`, jsonRequest('POST', { ...newcomer(), ...body }));
  }

  async function pendingInvitations(admin: SignedInMember) {
    const listed = (await (await admin.request('/api/invitations')).json()) as Invitation[];
    return listed.filter((i) => i.status === 'pending').map((i) => i.id);
  }

  test('offers email to the join form', async () => {
    expect(await (await mailCtx.app.request('/api/capabilities')).json()).toMatchObject({ email: true });
  });

  test('the invitee verifies an email, joins with it and can sign in with it', async () => {
    const admin = await signUpHousehold(mailCtx);
    const { id } = await invite(admin);
    const email = newcomerEmail();
    expect((await sendJoinCode(mailCtx, email, id)).status).toBe(204);

    const account = newcomer();
    const res = await mailCtx.app.request(
      `/api/join/${id}`,
      jsonRequest('POST', { ...account, email: email.toUpperCase(), code: await mailer.codeFor(email) }),
    );
    expect(res.status).toBe(201);
    expect(await (await requestAs(mailCtx, sessionCookie(res), '/api/me')).json()).toMatchObject({
      user: { username: account.username, email },
      household: { id: admin.householdId, role: 'member' },
    });
    const cookie = await signIn(mailCtx, email, account.password);
    expect((await requestAs(mailCtx, cookie, '/api/me')).status).toBe(200);
    expect(await pendingInvitations(admin)).toEqual([]);
  });

  test('mails join codes only for a usable invitation', async () => {
    const admin = await signUpHousehold(mailCtx);
    const { id } = await invite(admin);
    await admin.request(`/api/invitations/${id}/revoke`, { method: 'POST' });
    const email = newcomerEmail();

    const missing = await sendJoinCode(mailCtx, email);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
    expect((await sendJoinCode(mailCtx, email, crypto.randomUUID())).status).toBe(404);
    const revoked = await sendJoinCode(mailCtx, email, id);
    expect(revoked.status).toBe(410);
    expect(await revoked.json()).toEqual({ error: 'invitation_revoked' });
    await mailer.expectNoMailTo(email);
  });

  test('refuses to join without a valid code and leaves the invitation usable', async () => {
    const admin = await signUpHousehold(mailCtx);
    const { id } = await invite(admin);
    const email = newcomerEmail();

    for (const body of [{}, { email }, { email, code: '000000' }]) {
      const res = await joinWithEmail(id, body);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'code_invalid' });
    }

    expect((await sendJoinCode(mailCtx, email, id)).status).toBe(204);
    const code = await mailer.codeFor(email);
    const wrong = code === '999999' ? '000000' : '999999';
    expect((await joinWithEmail(id, { email, code: wrong })).status).toBe(422);
    expect(await pendingInvitations(admin)).toEqual([id]);
    expect((await joinWithEmail(id, { email, code })).status).toBe(201);
  });

  test('a code mailed for another address does not admit', async () => {
    const admin = await signUpHousehold(mailCtx);
    const { id } = await invite(admin);
    const email = newcomerEmail();
    await sendJoinCode(mailCtx, email, id);
    const res = await joinWithEmail(id, { email: newcomerEmail(), code: await mailer.codeFor(email) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'code_invalid' });
  });

  test('a code is used once', async () => {
    const admin = await signUpHousehold(mailCtx);
    const [first, second] = [await invite(admin), await invite(admin)];
    const email = newcomerEmail();
    await sendJoinCode(mailCtx, email, first.id);
    const code = await mailer.codeFor(email);
    expect((await joinWithEmail(first.id, { email, code })).status).toBe(201);
    const again = await joinWithEmail(second.id, { email, code });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ error: 'code_invalid' });
  });

  test('rejects an email another account has, keeping the invitation usable', async () => {
    // The address was mailed a code moments ago; the clock moves past its resend cooldown.
    const start = new Date();
    setSystemTime(start);
    const admin = await signUpHousehold(mailCtx);
    const first = await joinHousehold(mailCtx, admin, { mailer });
    const { id } = await invite(admin);
    const taken = first.email!;
    setSystemTime(new Date(start.getTime() + 61_000));
    expect((await sendJoinCode(mailCtx, taken, id)).status).toBe(204);

    const res = await joinWithEmail(id, { email: taken, code: await mailer.codeFor(taken) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_taken' });
    expect(await pendingInvitations(admin)).toEqual([id]);
  });

  test('a taken username keeps the code usable', async () => {
    const admin = await signUpHousehold(mailCtx);
    const { id } = await invite(admin);
    const email = newcomerEmail();
    await sendJoinCode(mailCtx, email, id);
    const code = await mailer.codeFor(email);

    const res = await joinWithEmail(id, { email, code, username: admin.username });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'username_taken' });
    expect((await joinWithEmail(id, { email, code })).status).toBe(201);
  });

  test('a refused invitation leaves the code usable', async () => {
    const admin = await signUpHousehold(mailCtx);
    const { id } = await invite(admin);
    const other = await invite(admin);
    const email = newcomerEmail();
    await sendJoinCode(mailCtx, email, id);
    const code = await mailer.codeFor(email);
    await admin.request(`/api/invitations/${id}/revoke`, { method: 'POST' });

    const res = await joinWithEmail(id, { email, code });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'invitation_revoked' });
    expect((await joinWithEmail(other.id, { email, code })).status).toBe(201);
  });
});
