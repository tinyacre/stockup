import { describe, expect, test } from 'bun:test';
import { joinHousehold, jsonRequest, requestAs, signIn, signUpHousehold, useTestApp } from './support/harness';

const ctx = useTestApp();

interface Promotion {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

async function promotionsOf(member: Awaited<ReturnType<typeof signUpHousehold>>) {
  const res = await member.request('/api/promotions');
  expect(res.status).toBe(200);
  return (await res.json()) as Promotion[];
}

describe('a new household', () => {
  test('starts with the preset promotions', async () => {
    const member = await signUpHousehold(ctx);
    const promotions = await promotionsOf(member);
    expect(promotions.map((p) => p.name).sort()).toEqual(['38 节', '618', '双 11', '双 12', '年货节'].sort());
    expect(promotions.find((p) => p.name === '双 11')).toMatchObject({ startsOn: '10-20', endsOn: '11-11' });
  });
});

describe('household isolation', () => {
  test('a member sees only their own household', async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const aliceIds = (await promotionsOf(alice)).map((p) => p.id);
    const bobIds = (await promotionsOf(bob)).map((p) => p.id);
    expect(aliceIds.filter((id) => bobIds.includes(id))).toEqual([]);
  });

  test("a member cannot read another household's records", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const [bobsPromotion] = await promotionsOf(bob);

    expect((await bob.request(`/api/promotions/${bobsPromotion!.id}`)).status).toBe(200);
    const res = await alice.request(`/api/promotions/${bobsPromotion!.id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  test('household data requires a signed-in member', async () => {
    expect((await ctx.app.request('/api/promotions')).status).toBe(401);
  });
});

describe('one household per member', () => {
  test('members cannot create or join households through Better Auth endpoints', async () => {
    const member = await signUpHousehold(ctx);
    const create = await member.request(
      '/api/auth/organization/create',
      jsonRequest('POST', { name: 'Second home', slug: `second-${crypto.randomUUID()}` }),
    );
    expect(create.status).toBe(404);
    const accept = await member.request(
      '/api/auth/organization/accept-invitation',
      jsonRequest('POST', { invitationId: crypto.randomUUID() }),
    );
    expect(accept.status).toBe(404);
  });

  test('the database refuses a second membership', async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    await expect(
      ctx.auth.api.addMember({ body: { userId: alice.userId, organizationId: bob.householdId, role: 'member' } }),
    ).rejects.toThrow();

    const me = await alice.request('/api/me');
    expect(await me.json()).toMatchObject({ household: { id: alice.householdId } });
  });
});

describe('creating a household', () => {
  function newHousehold() {
    const suffix = crypto.randomUUID().slice(0, 8);
    return {
      householdName: `Second home ${suffix}`,
      admin: { username: `admin_${suffix}`, password: `password-${suffix}`, name: `Admin ${suffix}` },
    };
  }

  test('the instance admin creates a household whose new admin signs in to the preset promotions', async () => {
    const instanceAdmin = await signUpHousehold(ctx, { instanceAdmin: true });
    const input = newHousehold();
    const res = await instanceAdmin.request('/api/households', jsonRequest('POST', input));
    expect(res.status).toBe(201);
    const { householdId, userId } = (await res.json()) as { householdId: string; userId: string };

    const cookie = await signIn(ctx, input.admin.username, input.admin.password);
    expect(await (await requestAs(ctx, cookie, '/api/me')).json()).toMatchObject({
      user: { id: userId, name: input.admin.name, isInstanceAdmin: false },
      household: { id: householdId, name: input.householdName, role: 'admin' },
    });
    const promotions = (await (await requestAs(ctx, cookie, '/api/promotions')).json()) as { name: string }[];
    expect(promotions.map((p) => p.name).sort()).toEqual(['38 节', '618', '双 11', '双 12', '年货节'].sort());

    const listed = (await (await instanceAdmin.request('/api/households')).json()) as {
      id: string;
      name: string;
      memberCount: number;
    }[];
    expect(listed).toContainEqual(expect.objectContaining({ id: householdId, name: input.householdName, memberCount: 1 }));
    expect(await (await instanceAdmin.request('/api/me')).json()).toMatchObject({
      household: { id: instanceAdmin.householdId },
    });
  });

  test("rejects an admin username that is already taken", async () => {
    const instanceAdmin = await signUpHousehold(ctx, { instanceAdmin: true });
    const input = newHousehold();
    const res = await instanceAdmin.request(
      '/api/households',
      jsonRequest('POST', { ...input, admin: { ...input.admin, username: instanceAdmin.username } }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'username_taken' });
  });

  test('household admins and members cannot create or list households', async () => {
    const householdAdmin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, householdAdmin);
    for (const m of [householdAdmin, member]) {
      const res = await m.request('/api/households', jsonRequest('POST', newHousehold()));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
      expect((await m.request('/api/households')).status).toBe(403);
    }
  });

  test('requires a signed-in member', async () => {
    expect((await ctx.app.request('/api/households', jsonRequest('POST', newHousehold()))).status).toBe(401);
  });

  test('the instance admin keeps managing households after leaving their own household', async () => {
    const founder = await signUpHousehold(ctx, { instanceAdmin: true });
    const successor = await joinHousehold(ctx, founder);
    await founder.request(`/api/members/${successor.userId}/make-admin`, { method: 'POST' });
    expect((await successor.request(`/api/members/${founder.userId}`, { method: 'DELETE' })).status).toBe(204);

    const cookie = await signIn(ctx, founder.username, founder.password);
    const res = await requestAs(ctx, cookie, '/api/households', jsonRequest('POST', newHousehold()));
    expect(res.status).toBe(201);
  });
});
