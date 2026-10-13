import { describe, expect, test } from 'bun:test';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

const ctx = useTestApp();

interface Channel {
  id: string;
  name: string;
  archived: boolean;
}

function unique(label: string) {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

function createChannel(m: SignedInMember, name = unique('京东')) {
  return m.request('/api/channels', jsonRequest('POST', { name }));
}

async function created(res: Response): Promise<Channel> {
  expect(res.status).toBe(201);
  return (await res.json()) as Channel;
}

function updateChannel(m: SignedInMember, id: string, body: object) {
  return m.request(`/api/channels/${id}`, jsonRequest('PATCH', body));
}

async function channelsOf(m: SignedInMember, query = '') {
  const res = await m.request(`/api/channels${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Channel[];
}

describe('channels', () => {
  test('are created and listed by name', async () => {
    const m = await signUpHousehold(ctx);
    const sams = await created(await createChannel(m, '山姆'));
    const jd = await created(await createChannel(m, '  京东 '));
    expect(sams).toEqual({ id: sams.id, name: '山姆', archived: false });
    expect(jd.name).toBe('京东');

    expect((await channelsOf(m)).map((c) => c.name)).toEqual(['京东', '山姆']);
  });

  test('are renamed', async () => {
    const m = await signUpHousehold(ctx);
    const channel = await created(await createChannel(m, '天猫'));

    const res = await updateChannel(m, channel.id, { name: '天猫超市' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: channel.id, name: '天猫超市', archived: false });
  });

  test('names are unique within the household, archived ones included', async () => {
    const m = await signUpHousehold(ctx);
    const channel = await created(await createChannel(m, '楼下超市'));
    await updateChannel(m, channel.id, { archived: true });

    const duplicate = await createChannel(m, '楼下超市');
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'name_taken' });

    const other = await created(await createChannel(m));
    expect((await updateChannel(m, other.id, { name: '楼下超市' })).status).toBe(409);

    expect((await createChannel(await signUpHousehold(ctx), '楼下超市')).status).toBe(201);
  });

  test('a blank name or an empty change is rejected', async () => {
    const m = await signUpHousehold(ctx);
    expect((await createChannel(m, '  ')).status).toBe(400);
    const channel = await created(await createChannel(m));
    expect((await updateChannel(m, channel.id, {})).status).toBe(400);
  });

  test('archived channels leave the default list but stay reachable', async () => {
    const m = await signUpHousehold(ctx);
    const kept = await created(await createChannel(m, '京东'));
    const old = await created(await createChannel(m, '苏宁'));

    const archived = await updateChannel(m, old.id, { archived: true });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toEqual({ id: old.id, name: '苏宁', archived: true });

    expect(await channelsOf(m)).toEqual([kept]);
    expect(await channelsOf(m, '?includeArchived=true')).toEqual([kept, { ...old, archived: true }]);
    const detail = await m.request(`/api/channels/${old.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({ id: old.id, name: '苏宁', archived: true });
  });

  test('archived channels are restored', async () => {
    const m = await signUpHousehold(ctx);
    const channel = await created(await createChannel(m));
    await updateChannel(m, channel.id, { archived: true });

    const restored = await updateChannel(m, channel.id, { archived: false });
    expect(await restored.json()).toEqual(channel);
    expect(await channelsOf(m)).toEqual([channel]);
  });

  test('are deleted', async () => {
    const m = await signUpHousehold(ctx);
    const channel = await created(await createChannel(m));
    expect((await m.request(`/api/channels/${channel.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await m.request(`/api/channels/${channel.id}`)).status).toBe(404);
  });
});

describe('household isolation', () => {
  test("another household's channels are invisible", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const channel = await created(await createChannel(bob));

    expect(await channelsOf(alice, '?includeArchived=true')).toEqual([]);
    expect((await alice.request(`/api/channels/${channel.id}`)).status).toBe(404);
  });

  test("another household's channels cannot be changed", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const channel = await created(await createChannel(bob));

    const attempts = [
      updateChannel(alice, channel.id, { name: 'hijacked' }),
      updateChannel(alice, channel.id, { archived: true }),
      alice.request(`/api/channels/${channel.id}`, { method: 'DELETE' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    expect(await channelsOf(bob)).toEqual([channel]);
  });

  test('channels require a signed-in member', async () => {
    expect((await ctx.app.request('/api/channels')).status).toBe(401);
    expect((await ctx.app.request('/api/channels', jsonRequest('POST', { name: '京东' }))).status).toBe(401);
  });
});
