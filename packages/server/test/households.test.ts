import { describe, expect, test } from 'bun:test';
import { jsonRequest, signUpHousehold, useTestApp } from './support/harness';

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
