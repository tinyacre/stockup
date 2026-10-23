import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CLAUDE_CLIENT_ID } from './support/claude-metadata';
import { jsonRequest, joinHousehold, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';
import { authorizeAsClaude, connectAsClaude } from './support/mcp-client';

const ctx = useTestApp({ listen: true });

interface Product {
  id: string;
  name: string;
  archived: boolean;
}

async function seedProducts(m: SignedInMember, names: string[]) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const post = async <T>(path: string, body: unknown) => {
    const res = await m.request(path, jsonRequest('POST', body));
    expect(res.status).toBe(201);
    return (await res.json()) as T;
  };
  const group = await post<{ id: string }>('/api/category-groups', { name: `生活用品 ${suffix}` });
  const category = await post<{ id: string }>('/api/categories', { categoryGroupId: group.id, name: `纸品 ${suffix}` });
  const products: Product[] = [];
  for (const name of names) {
    products.push(
      await post<Product>('/api/products', {
        categoryId: category.id,
        name,
        pricingUnit: { dimension: 'count', name: '抽' },
        baseSize: 90,
      }),
    );
  }
  return products;
}

type McpClient = Awaited<ReturnType<typeof connectAsClaude>>['client'];

async function searchProducts(client: McpClient, args: Record<string, unknown>) {
  const result = await client.callTool({ name: 'search_products', arguments: args });
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { products: Product[] }).products;
}

const readTools = ['search_products', 'get_product', 'judge_price', 'list_channels', 'list_categories'];
const writeTools = [
  'create_product',
  'create_price_record',
  'create_channel',
  'update_channel',
  'delete_channel',
  'create_category_group',
  'update_category_group',
  'delete_category_group',
  'create_category',
  'update_category',
  'delete_category',
  'update_product',
  'merge_products',
  'delete_product',
  'update_price_record',
  'delete_price_record',
];

const mcpUrl = () => new URL('/mcp', ctx.baseUrl);
const listTools = (headers: Record<string, string> = {}) =>
  fetch(mcpUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

describe('MCP discovery', () => {
  test('an unauthenticated request points at the protected resource metadata', async () => {
    const res = await listTools();
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate')!;
    expect(challenge).toStartWith('Bearer ');
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)![1]!;

    const metadata = (await (await fetch(metadataUrl)).json()) as { resource: string; authorization_servers: string[] };
    expect(metadata.resource).toBe(mcpUrl().toString());
    expect(metadata.authorization_servers).toEqual([`${ctx.baseUrl}/api/auth`]);
  });

  test('the authorization server accepts client metadata documents and offers no dynamic registration', async () => {
    const res = await fetch(new URL('/.well-known/oauth-authorization-server/api/auth', ctx.baseUrl));
    expect(res.status).toBe(200);
    const metadata = (await res.json()) as Record<string, unknown>;
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.registration_endpoint).toBeUndefined();
    expect(metadata.code_challenge_methods_supported).toContain('S256');
  });
});

describe('MCP client registration', () => {
  test('a signed-in member cannot register a client of their own', async () => {
    const m = await signUpHousehold(ctx);
    const client = { redirect_uris: ['https://attacker.example/callback'], client_name: 'Claude' };
    expect((await m.request('/api/auth/oauth2/create-client', jsonRequest('POST', client))).status).toBe(401);
    expect((await m.request('/api/auth/oauth2/register', jsonRequest('POST', client))).status).toBe(403);
  });

  test('a member already signed in goes straight to consent for Claude', async () => {
    const m = await signUpHousehold(ctx);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLAUDE_CLIENT_ID,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 'state',
      scope: 'stockup:read',
      resource: mcpUrl().toString(),
    });
    const res = await fetch(new URL(`/api/auth/oauth2/authorize?${params}`, ctx.baseUrl), {
      redirect: 'manual',
      headers: { cookie: m.cookie },
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!, ctx.baseUrl).pathname).toBe('/oauth/consent');
  });
});

describe('MCP authorization', () => {
  test('a member authorizes Claude in the browser and searches their products', async () => {
    const m = await signUpHousehold(ctx);
    const [tissues] = await seedProducts(m, ['得宝抽纸 M 码', '豆腐猫砂']);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...readTools, ...writeTools].sort());
    expect(await searchProducts(client, { query: 'dbcz' })).toEqual([tissues!]);
  });

  test('the access token names the member and Claude, not the household', async () => {
    const m = await signUpHousehold(ctx);
    const { accessToken } = await authorizeAsClaude(ctx.baseUrl, m);
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString());
    expect(claims).toMatchObject({ sub: m.userId, azp: CLAUDE_CLIENT_ID });
    expect(claims.aud).toContain(mcpUrl().toString());
    expect(JSON.stringify(claims)).not.toContain(m.householdId);
  });

  test('a malformed bearer token is turned away', async () => {
    const res = await listTools({ authorization: 'Bearer not-a-jwt' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  test('a token signed by another server is turned away', async () => {
    const m = await signUpHousehold(ctx);
    const { accessToken } = await authorizeAsClaude(ctx.baseUrl, m);
    const [header, payload] = accessToken.split('.');
    const forged = `${header}.${payload}.${Buffer.from('not the signature').toString('base64url')}`;
    expect((await listTools({ authorization: `Bearer ${forged}` })).status).toBe(401);
  });

  test('a token without the StockUp scope cannot call tools', async () => {
    const m = await signUpHousehold(ctx);
    const { accessToken } = await authorizeAsClaude(ctx.baseUrl, m, { scope: 'openid profile' });
    const res = await listTools({ authorization: `Bearer ${accessToken}` });
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
  });
});

describe('MCP household isolation', () => {
  test("each member's token only reaches their own household's products", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const [alices] = await seedProducts(alice, ['得宝抽纸 M 码']);
    const [bobs] = await seedProducts(bob, ['清风抽纸']);
    const asAlice = (await connectAsClaude(ctx.baseUrl, alice)).client;
    const asBob = (await connectAsClaude(ctx.baseUrl, bob)).client;

    expect(await searchProducts(asAlice, { query: '抽纸', includeArchived: true })).toEqual([alices!]);
    expect(await searchProducts(asBob, { query: '抽纸', includeArchived: true })).toEqual([bobs!]);
    expect(await searchProducts(asAlice, { query: '清风' })).toEqual([]);
    expect(await searchProducts(asBob, { query: 'dbcz' })).toEqual([]);
  });

  test('members of the same household share its products', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);
    const [product] = await seedProducts(admin, ['维达卷纸']);
    const { client } = await connectAsClaude(ctx.baseUrl, member);
    expect(await searchProducts(client, { query: '卷纸' })).toEqual([product!]);
  });

  test('a member removed from the household loses access before the token expires', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);
    await seedProducts(admin, ['维达卷纸']);
    const { client } = await connectAsClaude(ctx.baseUrl, member);
    expect(await searchProducts(client, { query: '卷纸' })).toHaveLength(1);

    expect((await admin.request(`/api/members/${member.userId}`, { method: 'DELETE' })).status).toBe(204);
    const result = await client.callTool({ name: 'search_products', arguments: { query: '卷纸' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain('不属于任何家庭');
  });
});

describe('search_products', () => {
  test('leaves archived products out unless asked, and honours the limit', async () => {
    const m = await signUpHousehold(ctx);
    const [old, current] = await seedProducts(m, ['得宝抽纸 旧款包装', '得宝抽纸 M 码']);
    expect((await m.request(`/api/products/${old!.id}`, jsonRequest('PATCH', { archived: true }))).status).toBe(200);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    expect(await searchProducts(client, { query: '得宝' })).toEqual([current!]);
    expect((await searchProducts(client, { query: '得宝', includeArchived: true })).map((p) => p.name)).toEqual([
      '得宝抽纸 M 码',
      '得宝抽纸 旧款包装',
    ]);
    expect(await searchProducts(client, { query: '得宝', includeArchived: true, limit: 1 })).toHaveLength(1);
  });

  test('rejects a blank query', async () => {
    const m = await signUpHousehold(ctx);
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const result = await client.callTool({ name: 'search_products', arguments: { query: '  ' } });
    expect(result.isError).toBe(true);
  });
});

interface Setup {
  product: Product & { stockLine: number | null };
  categoryId: string;
  channelId: string;
}

async function post<T>(m: SignedInMember, path: string, body: unknown) {
  const res = await m.request(path, jsonRequest('POST', body));
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

const sheet = { dimension: 'count', name: '抽' };

async function seedHousehold(m: SignedInMember, pricingUnit: object = sheet, baseSize = 130): Promise<Setup> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const group = await post<{ id: string }>(m, '/api/category-groups', { name: `生活用品 ${suffix}` });
  const category = await post<{ id: string }>(m, '/api/categories', {
    categoryGroupId: group.id,
    name: `纸品 ${suffix}`,
  });
  const product = await post<Setup['product']>(m, '/api/products', {
    categoryId: category.id,
    name: `京东抽纸 ${suffix}`,
    pricingUnit,
    baseSize,
  });
  const channel = await post<{ id: string }>(m, '/api/channels', { name: `京东 ${suffix}` });
  return { product, categoryId: category.id, channelId: channel.id };
}

function recordPrice(m: SignedInMember, s: Setup, date: string, listPrice: number, quantity = 1) {
  return post<{ id: string; unitPrice: number }>(m, '/api/price-records', {
    productId: s.product.id,
    channelId: s.channelId,
    date,
    purchased: true,
    listPrice,
    discounts: [],
    quantity,
    size: { amount: 130, unit: sheet },
  });
}

async function call<T = Record<string, unknown>>(client: McpClient, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  return result.structuredContent as T;
}

async function callFails(client: McpClient, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  return JSON.stringify(result.content);
}

const allScopes = 'stockup:read stockup:write offline_access';

describe('MCP tool set', () => {
  test('offers nothing that manages members, and marks deletes and merges destructive', async () => {
    const m = await signUpHousehold(ctx);
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.name).not.toMatch(/member|invit|household/);
      if (readTools.includes(tool.name)) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      } else {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: tool.name.startsWith('delete_') || tool.name.startsWith('merge_'),
        });
      }
    }
  });

  test('a token without the write scope offers only the read tools', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const { client } = await connectAsClaude(ctx.baseUrl, m, { scope: 'stockup:read' });

    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...readTools].sort());
    const created = client.callTool({
      name: 'create_product',
      arguments: { categoryId: s.categoryId, name: '维达卷纸', pricingUnit: sheet, baseSize: 100 },
    });
    await expect(created).rejects.toThrow('Tool create_product not found');
  });
});

describe('get_product', () => {
  test('describes the price history, stock line, lowest unit price and promotion lowests', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    expect((await m.request(`/api/products/${s.product.id}`, jsonRequest('PATCH', { stockLine: 600 }))).status).toBe(
      200,
    );
    const promotion = await post<{ id: string }>(m, '/api/promotions', {
      name: `双11 ${crypto.randomUUID().slice(0, 4)}`,
      startsOn: '11-01',
      endsOn: '11-11',
    });
    await recordPrice(m, s, '2025-11-11', 5000, 10);
    await recordPrice(m, s, '2025-11-05', 4500, 10);
    const latest = await recordPrice(m, s, '2026-04-15', 7000, 10);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const detail = await call<{
      product: Setup['product'];
      lowestUnitPrice: number;
      promotionLowests: { promotion: { id: string; name: string }; year: number; lowestUnitPrice: number }[];
      priceRecordCount: number;
      priceRecords: { id: string; date: string; unitPrice: number; promotion: { id: string } | null }[];
    }>(client, 'get_product', { productId: s.product.id });

    expect(detail.product).toMatchObject({ id: s.product.id, stockLine: 600 });
    expect(detail.lowestUnitPrice).toBe(450);
    expect(detail.promotionLowests).toEqual([
      { promotion: { id: promotion.id, name: expect.stringContaining('双11') }, year: 2025, lowestUnitPrice: 450 },
    ]);
    expect(detail.priceRecordCount).toBe(3);
    expect(detail.priceRecords.map((r) => [r.date, r.unitPrice])).toEqual([
      ['2026-04-15', 700],
      ['2025-11-11', 500],
      ['2025-11-05', 450],
    ]);
    expect(detail.priceRecords[0]!.id).toBe(latest.id);
    expect(detail.priceRecords[1]!.promotion?.id).toBe(promotion.id);

    const limited = await call<{ priceRecordCount: number; priceRecords: unknown[] }>(client, 'get_product', {
      productId: s.product.id,
      limit: 1,
    });
    expect(limited.priceRecordCount).toBe(3);
    expect(limited.priceRecords).toHaveLength(1);
  });

  test("a product without price records has no references, and another household's product is not found", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    const others = await seedHousehold(bob);
    const { client } = await connectAsClaude(ctx.baseUrl, alice);

    expect(await call(client, 'get_product', { productId: own.product.id })).toMatchObject({
      lowestUnitPrice: null,
      promotionLowests: [],
      priceRecordCount: 0,
      priceRecords: [],
    });
    expect(await callFails(client, 'get_product', { productId: others.product.id })).toContain('商品');
  });
});

describe('judge_price', () => {
  test('judges a quote the same way the web does and stores nothing', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    expect((await m.request(`/api/products/${s.product.id}`, jsonRequest('PATCH', { stockLine: 600 }))).status).toBe(
      200,
    );
    await recordPrice(m, s, '2026-03-01', 7000, 10);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    // 99 元 3 提 × 6 包 × 130 抽
    const quote = { productId: s.product.id, listPrice: 9900, quantity: 18, size: { amount: 130, unit: sheet } };
    const judgment = await call(client, 'judge_price', quote);
    const web = await m.request('/api/judgments', jsonRequest('POST', { ...quote, discounts: [] }));
    expect(web.status).toBe(200);
    expect(judgment).toEqual((await web.json()) as Record<string, unknown>);
    expect(judgment).toMatchObject({ netPrice: 9900, unitPrice: 550, verdict: 'recordLow' });

    const withDiscount = await call(client, 'judge_price', { ...quote, discounts: [{ amount: 900, name: '满减' }] });
    expect(withDiscount).toMatchObject({ netPrice: 9000, unitPrice: 500 });

    const records = (await (await m.request(`/api/price-records?productId=${s.product.id}`)).json()) as unknown[];
    expect(records).toHaveLength(1);
  });

  test("rejects another household's product and a size in another unit", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    const others = await seedHousehold(bob);
    const { client } = await connectAsClaude(ctx.baseUrl, alice);
    const quote = { listPrice: 9900, quantity: 18, size: { amount: 130, unit: sheet } };

    expect(await callFails(client, 'judge_price', { ...quote, productId: others.product.id })).toContain('商品');
    expect(
      await callFails(client, 'judge_price', {
        ...quote,
        productId: own.product.id,
        size: { amount: 1, unit: { dimension: 'weight', name: 'kg' } },
      }),
    ).toContain('单位');
  });
});

describe('list_channels and list_categories', () => {
  test("list only the member's own household", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    await seedHousehold(bob);
    const archived = await post<{ id: string; name: string }>(alice, '/api/channels', { name: '淘宝 旧店' });
    expect((await alice.request(`/api/channels/${archived.id}`, jsonRequest('PATCH', { archived: true }))).status).toBe(
      200,
    );
    const { client } = await connectAsClaude(ctx.baseUrl, alice);

    const { channels } = await call<{ channels: { id: string; archived: boolean }[] }>(client, 'list_channels', {});
    expect(channels.map((c) => c.id)).toEqual([own.channelId]);
    const withArchived = await call<{ channels: { id: string }[] }>(client, 'list_channels', { includeArchived: true });
    expect(withArchived.channels.map((c) => c.id).sort()).toEqual([own.channelId, archived.id].sort());

    const { categoryGroups } = await call<{
      categoryGroups: { categories: { id: string; name: string; productCount: number }[] }[];
    }>(client, 'list_categories', {});
    expect(categoryGroups.flatMap((g) => g.categories)).toEqual([
      { id: own.categoryId, name: expect.any(String), productCount: 1 },
    ]);
  });
});

describe('create_product', () => {
  test("creates a product in one of the household's categories", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    const others = await seedHousehold(bob);
    const { client } = await connectAsClaude(ctx.baseUrl, alice);
    const input = { name: '维达卷纸', pricingUnit: { dimension: 'count', name: '节' }, baseSize: 100 };

    const { product } = await call<{ product: Product }>(client, 'create_product', {
      ...input,
      categoryId: own.categoryId,
    });
    const stored = await alice.request(`/api/products/${product.id}`);
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({ ...input, categoryId: own.categoryId, stockLine: null });

    expect(await callFails(client, 'create_product', { ...input, categoryId: others.categoryId })).toContain('品类');
    expect(await searchProducts(asClient(await connectAsClaude(ctx.baseUrl, bob)), { query: '维达' })).toEqual([]);
  });
});

const asClient = (connected: { client: McpClient }) => connected.client;

describe('create_price_record', () => {
  test('records a price as the member, from MCP, converting the size and tagging the promotion', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m, { dimension: 'weight', name: 'g' }, 500);
    const promotion = await post<{ id: string }>(m, '/api/promotions', {
      name: `618 ${crypto.randomUUID().slice(0, 4)}`,
      startsOn: '06-01',
      endsOn: '06-18',
    });
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const { priceRecord } = await call<{ priceRecord: { id: string } }>(client, 'create_price_record', {
      productId: s.product.id,
      channelId: s.channelId,
      date: '2026-06-18',
      purchased: true,
      listPrice: 5980,
      discounts: [{ amount: 1000, name: '满减' }],
      quantity: 2,
      size: { amount: 1.5, unit: { dimension: 'weight', name: 'kg' } },
    });

    const stored = await m.request(`/api/price-records/${priceRecord.id}`);
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({
      size: { amount: 1500, unit: { name: 'g' } },
      enteredSize: { amount: 1.5, unit: { name: 'kg' } },
      promotion: { id: promotion.id },
      recordedBy: { id: m.userId },
      source: 'mcp',
      netPrice: 4980,
      unitPrice: 830,
    });
  });

  test("rejects another household's product or channel and writes nothing there", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    const others = await seedHousehold(bob);
    const { client } = await connectAsClaude(ctx.baseUrl, alice);
    const input = {
      date: '2026-03-01',
      purchased: false,
      listPrice: 9900,
      quantity: 18,
      size: { amount: 130, unit: sheet },
    };

    const messages = [
      await callFails(client, 'create_price_record', {
        ...input,
        productId: others.product.id,
        channelId: own.channelId,
      }),
      await callFails(client, 'create_price_record', {
        ...input,
        productId: own.product.id,
        channelId: others.channelId,
      }),
    ];
    expect(messages[0]).toContain('商品');
    expect(messages[1]).toContain('渠道');
    for (const [member, productId] of [
      [alice, own.product.id],
      [bob, others.product.id],
    ] as const) {
      const records = (await (await member.request(`/api/price-records?productId=${productId}`)).json()) as unknown[];
      expect(records).toEqual([]);
    }
  });
});

interface Channel {
  id: string;
  name: string;
  archived: boolean;
}

describe('channel tools', () => {
  test('create, rename, archive and restore a channel; archived channels leave the default list', async () => {
    const m = await signUpHousehold(ctx);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const { channel } = await call<{ channel: Channel }>(client, 'create_channel', { name: '  山姆  ' });
    expect(channel).toEqual({ id: expect.any(String), name: '山姆', archived: false });
    const renamed = await call<{ channel: Channel }>(client, 'update_channel', {
      channelId: channel.id,
      name: '山姆会员店',
    });
    expect(renamed.channel).toEqual({ ...channel, name: '山姆会员店' });

    const archived = await call<{ channel: Channel }>(client, 'update_channel', {
      channelId: channel.id,
      archived: true,
    });
    expect(archived.channel.archived).toBe(true);
    expect((await call<{ channels: Channel[] }>(client, 'list_channels', {})).channels).toEqual([]);
    expect((await call<{ channels: Channel[] }>(client, 'list_channels', { includeArchived: true })).channels).toEqual([
      { id: channel.id, name: '山姆会员店', archived: true },
    ]);

    await call(client, 'update_channel', { channelId: channel.id, archived: false });
    const stored = await m.request(`/api/channels/${channel.id}`);
    expect(await stored.json()).toEqual({ id: channel.id, name: '山姆会员店', archived: false });

    expect(await callFails(client, 'update_channel', { channelId: channel.id })).toBeTruthy();
  });

  test('a taken name or a channel in use fails with a sentence saying what to do instead', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    await recordPrice(m, s, '2026-03-01', 7000);
    const other = await post<Channel>(m, '/api/channels', { name: '盒马' });
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const { channels } = await call<{ channels: Channel[] }>(client, 'list_channels', {});
    const used = channels.find((c) => c.id === s.channelId)!;

    expect(await callFails(client, 'create_channel', { name: used.name })).toContain('同名');
    expect(await callFails(client, 'update_channel', { channelId: other.id, name: used.name })).toContain('同名');
    expect(await callFails(client, 'delete_channel', { channelId: s.channelId })).toContain('归档');
    expect((await m.request(`/api/channels/${s.channelId}`)).status).toBe(200);

    expect(await call(client, 'delete_channel', { channelId: other.id })).toEqual({ deletedId: other.id });
    expect((await m.request(`/api/channels/${other.id}`)).status).toBe(404);
  });

  test("another household's channel is not found and stays as it was", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const bobs = await post<Channel>(bob, '/api/channels', { name: '拼多多' });
    const { client } = await connectAsClaude(ctx.baseUrl, alice);

    expect(await callFails(client, 'update_channel', { channelId: bobs.id, archived: true })).toContain('渠道');
    expect(await callFails(client, 'delete_channel', { channelId: bobs.id })).toContain('渠道');
    expect(await (await bob.request(`/api/channels/${bobs.id}`)).json()).toEqual(bobs);

    await call(client, 'create_channel', { name: '拼多多' });
    expect((await (await bob.request('/api/channels')).json()) as Channel[]).toEqual([bobs]);
  });
});

interface CategoryGroup {
  id: string;
  name: string;
}

interface Category extends CategoryGroup {
  categoryGroupId: string;
}

describe('category tools', () => {
  test('create and rename groups, create categories in them, and move a category to another group', async () => {
    const m = await signUpHousehold(ctx);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const { categoryGroup: food } = await call<{ categoryGroup: CategoryGroup }>(client, 'create_category_group', {
      name: '食品',
    });
    const { categoryGroup: home } = await call<{ categoryGroup: CategoryGroup }>(client, 'create_category_group', {
      name: '日用',
    });
    expect(
      (
        await call<{ categoryGroup: CategoryGroup }>(client, 'update_category_group', {
          categoryGroupId: home.id,
          name: '生活用品',
        })
      ).categoryGroup,
    ).toEqual({ id: home.id, name: '生活用品' });

    const { category } = await call<{ category: Category }>(client, 'create_category', {
      categoryGroupId: food.id,
      name: '纸品',
    });
    expect(category).toEqual({ id: expect.any(String), name: '纸品', categoryGroupId: food.id });
    const moved = await call<{ category: Category }>(client, 'update_category', {
      categoryId: category.id,
      categoryGroupId: home.id,
      name: '抽纸',
    });
    expect(moved.category).toEqual({ id: category.id, name: '抽纸', categoryGroupId: home.id });

    const { categoryGroups } = await call<{ categoryGroups: (CategoryGroup & { categories: CategoryGroup[] })[] }>(
      client,
      'list_categories',
      {},
    );
    expect(categoryGroups.map((g) => [g.name, g.categories.map((c) => c.name)])).toEqual([
      ['生活用品', ['抽纸']],
      ['食品', []],
    ]);
    expect(await callFails(client, 'update_category', { categoryId: category.id })).toBeTruthy();
  });

  test('taken names and groups or categories still holding something fail with a sentence saying why', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const [group] = (
      await call<{ categoryGroups: (CategoryGroup & { categories: CategoryGroup[] })[] }>(client, 'list_categories', {})
    ).categoryGroups;
    const seeded = group!.categories[0]!;

    expect(await callFails(client, 'create_category_group', { name: group!.name })).toContain('同名');
    expect(await callFails(client, 'create_category', { categoryGroupId: group!.id, name: seeded.name })).toContain(
      '同名',
    );
    expect(await callFails(client, 'delete_category', { categoryId: s.categoryId })).toContain('商品');
    expect(await callFails(client, 'delete_category_group', { categoryGroupId: group!.id })).toContain('品类');

    const { categoryGroup: spare } = await call<{ categoryGroup: CategoryGroup }>(client, 'create_category_group', {
      name: '杂项',
    });
    const { category: empty } = await call<{ category: Category }>(client, 'create_category', {
      categoryGroupId: spare.id,
      name: '待分类',
    });
    expect(
      await callFails(client, 'update_category_group', { categoryGroupId: spare.id, name: group!.name }),
    ).toContain('同名');
    expect(await call(client, 'delete_category', { categoryId: empty.id })).toEqual({ deletedId: empty.id });
    expect(await call(client, 'delete_category_group', { categoryGroupId: spare.id })).toEqual({ deletedId: spare.id });
    expect(((await (await m.request('/api/category-groups')).json()) as CategoryGroup[]).map((g) => g.id)).toEqual([
      group!.id,
    ]);
  });

  test("another household's groups and categories are not found and stay as they were", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    const others = await seedHousehold(bob);
    const bobsCatalog = await (await bob.request('/api/category-groups')).json();
    const bobsGroupId = (bobsCatalog as CategoryGroup[])[0]!.id;
    const { client } = await connectAsClaude(ctx.baseUrl, alice);

    expect(await callFails(client, 'update_category_group', { categoryGroupId: bobsGroupId, name: '改名' })).toContain(
      '大类',
    );
    expect(await callFails(client, 'delete_category_group', { categoryGroupId: bobsGroupId })).toContain('大类');
    expect(await callFails(client, 'create_category', { categoryGroupId: bobsGroupId, name: '偷放' })).toContain(
      '大类',
    );
    expect(await callFails(client, 'update_category', { categoryId: others.categoryId, name: '改名' })).toContain(
      '品类',
    );
    expect(await callFails(client, 'delete_category', { categoryId: others.categoryId })).toContain('品类');
    expect(
      await callFails(client, 'update_category', { categoryId: own.categoryId, categoryGroupId: bobsGroupId }),
    ).toContain('大类');

    expect(await (await bob.request('/api/category-groups')).json()).toEqual(bobsCatalog);
  });
});

interface StoredProduct extends Product {
  categoryGroupId: string;
  categoryId: string | null;
  pricingUnit: { dimension: string; name: string };
  baseSize: number;
  stockLine: number | null;
}

const listRecords = async (m: SignedInMember, productId: string) => {
  const res = await m.request(`/api/price-records?productId=${productId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; size: { amount: number; unit: { name: string } } }[];
};

describe('product tools', () => {
  test('rename, move, change the pricing unit, base size and stock line, and archive and restore a product', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m, { dimension: 'weight', name: 'g' }, 500);
    const groupId = (s.product as StoredProduct).categoryGroupId;
    const record = await post<{ id: string }>(m, '/api/price-records', {
      productId: s.product.id,
      channelId: s.channelId,
      date: '2026-03-01',
      purchased: true,
      listPrice: 2000,
      discounts: [],
      quantity: 1,
      size: { amount: 1500, unit: { dimension: 'weight', name: 'g' } },
    });
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const { product } = await call<{ product: StoredProduct }>(client, 'update_product', {
      productId: s.product.id,
      name: '五常大米',
      categoryGroupId: groupId,
      pricingUnit: { dimension: 'weight', name: 'kg' },
      baseSize: 1,
      stockLine: 1200,
      archived: true,
    });
    const expected = {
      id: s.product.id,
      name: '五常大米',
      categoryGroupId: groupId,
      categoryId: null,
      pricingUnit: { dimension: 'weight', name: 'kg' },
      baseSize: 1,
      stockLine: 1200,
      archived: true,
    };
    expect(product).toMatchObject(expected);
    expect(await (await m.request(`/api/products/${s.product.id}`)).json()).toMatchObject(expected);
    expect((await listRecords(m, s.product.id)).find((r) => r.id === record.id)!.size).toMatchObject({
      amount: 1.5,
      unit: { name: 'kg' },
    });
    expect(await searchProducts(client, { query: '五常' })).toEqual([]);

    await call(client, 'update_product', { productId: s.product.id, archived: false, categoryId: s.categoryId });
    expect(await (await m.request(`/api/products/${s.product.id}`)).json()).toMatchObject({
      archived: false,
      categoryId: s.categoryId,
    });
  });

  test('an empty change, two placements or a unit of another dimension fail and change nothing', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const groupId = (s.product as StoredProduct).categoryGroupId;
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const before = await (await m.request(`/api/products/${s.product.id}`)).json();

    expect(await callFails(client, 'update_product', { productId: s.product.id })).toBeTruthy();
    expect(
      await callFails(client, 'update_product', {
        productId: s.product.id,
        categoryId: s.categoryId,
        categoryGroupId: groupId,
      }),
    ).toBeTruthy();
    expect(
      await callFails(client, 'update_product', {
        productId: s.product.id,
        pricingUnit: { dimension: 'weight', name: 'g' },
      }),
    ).toContain('新建');
    expect(
      await callFails(client, 'update_product', {
        productId: s.product.id,
        pricingUnit: { dimension: 'count', name: '包' },
      }),
    ).toContain('新建');
    expect(await callFails(client, 'update_product', { productId: s.product.id, baseSize: 0 })).toBeTruthy();
    expect(await (await m.request(`/api/products/${s.product.id}`)).json()).toEqual(before);
  });

  test("merging moves the duplicate's price records to the kept product and removes the duplicate", async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const kept = await recordPrice(m, s, '2026-03-01', 7000);
    const duplicate = await post<Setup['product']>(m, '/api/products', {
      categoryId: s.categoryId,
      name: '京东抽纸 重复',
      pricingUnit: sheet,
      baseSize: 130,
    });
    const moved = await recordPrice(m, { ...s, product: duplicate }, '2026-04-01', 6500);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const { product } = await call<{ product: StoredProduct }>(client, 'merge_products', {
      productId: s.product.id,
      duplicateProductId: duplicate.id,
    });
    expect(product.id).toBe(s.product.id);
    expect((await listRecords(m, s.product.id)).map((r) => r.id).sort()).toEqual([kept.id, moved.id].sort());
    expect((await m.request(`/api/products/${duplicate.id}`)).status).toBe(404);

    expect(
      await callFails(client, 'merge_products', { productId: s.product.id, duplicateProductId: s.product.id }),
    ).toContain('同一个');
    expect(
      await callFails(client, 'merge_products', { productId: s.product.id, duplicateProductId: duplicate.id }),
    ).toContain('要合并');
  });

  test('merging a product priced in another dimension fails and keeps both', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const rice = await post<Product>(m, '/api/products', {
      categoryId: s.categoryId,
      name: '大米',
      pricingUnit: { dimension: 'weight', name: 'kg' },
      baseSize: 5,
    });
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    expect(
      await callFails(client, 'merge_products', { productId: s.product.id, duplicateProductId: rice.id }),
    ).toContain('计价单位');
    expect((await m.request(`/api/products/${rice.id}`)).status).toBe(200);
  });

  test('deletes a product without price records and refuses one that has some', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    await recordPrice(m, s, '2026-03-01', 7000);
    const spare = await post<Product>(m, '/api/products', {
      categoryId: s.categoryId,
      name: '建错的商品',
      pricingUnit: sheet,
      baseSize: 130,
    });
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    expect(await callFails(client, 'delete_product', { productId: s.product.id })).toContain('归档');
    expect((await m.request(`/api/products/${s.product.id}`)).status).toBe(200);
    expect(await call(client, 'delete_product', { productId: spare.id })).toEqual({ deletedId: spare.id });
    expect((await m.request(`/api/products/${spare.id}`)).status).toBe(404);
  });

  test("another household's products are not found and stay as they were", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    const others = await seedHousehold(bob);
    const othersGroupId = (others.product as StoredProduct).categoryGroupId;
    await recordPrice(bob, others, '2026-03-01', 7000);
    const bobsProduct = await (await bob.request(`/api/products/${others.product.id}`)).json();
    const bobsRecords = await listRecords(bob, others.product.id);
    const { client } = await connectAsClaude(ctx.baseUrl, alice);

    expect(await callFails(client, 'update_product', { productId: others.product.id, archived: true })).toContain(
      '商品',
    );
    expect(
      await callFails(client, 'update_product', { productId: own.product.id, categoryId: others.categoryId }),
    ).toContain('品类');
    expect(
      await callFails(client, 'update_product', { productId: own.product.id, categoryGroupId: othersGroupId }),
    ).toContain('大类');
    expect(
      await callFails(client, 'merge_products', { productId: own.product.id, duplicateProductId: others.product.id }),
    ).toContain('商品');
    expect(
      await callFails(client, 'merge_products', { productId: others.product.id, duplicateProductId: own.product.id }),
    ).toContain('商品');
    expect(await callFails(client, 'delete_product', { productId: others.product.id })).toContain('商品');

    expect(await (await bob.request(`/api/products/${others.product.id}`)).json()).toEqual(bobsProduct);
    expect(await listRecords(bob, others.product.id)).toEqual(bobsRecords);
    expect((await alice.request(`/api/products/${own.product.id}`)).status).toBe(200);
  });
});

interface StoredRecord {
  id: string;
  date: string;
  channel: { id: string };
  purchased: boolean;
  promotion: { id: string } | null;
  listPrice: number;
  discounts: { amount: number; name?: string }[];
  quantity: number;
  enteredSize: { amount: number; unit: { name: string } };
  note: string;
  netPrice: number;
  unitPrice: number;
  evidence: { id: string }[];
}

const readRecord = async (m: SignedInMember, id: string) => {
  const res = await m.request(`/api/price-records/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as StoredRecord;
};

async function attachEvidence(m: SignedInMember, recordId: string) {
  const form = new FormData();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  form.append('files', new File([png], 'a.png', { type: 'image/png' }));
  form.append('files', new File([png], 'b.png', { type: 'image/png' }));
  const res = await m.request(`/api/price-records/${recordId}/evidence`, { method: 'POST', body: form });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }[]).map((e) => e.id);
}

describe('price record tools', () => {
  test('get_product lists record ids that update_price_record replaces as a whole, repricing the history', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const other = await post<{ id: string }>(m, '/api/channels', { name: `山姆 ${crypto.randomUUID().slice(0, 8)}` });
    await recordPrice(m, s, '2026-03-01', 7000, 10);
    const typo = await recordPrice(m, s, '2026-03-02', 90000, 10);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    const before = await call<{ lowestUnitPrice: number; priceRecords: { id: string }[] }>(client, 'get_product', {
      productId: s.product.id,
    });
    expect(before.lowestUnitPrice).toBe(700);
    expect(before.priceRecords.map((r) => r.id)).toContain(typo.id);
    const quote = { productId: s.product.id, listPrice: 6500, quantity: 10, size: { amount: 130, unit: sheet } };
    expect(await call(client, 'judge_price', quote)).toMatchObject({ verdict: 'recordLow' });

    const { priceRecord } = await call<{ priceRecord: StoredRecord }>(client, 'update_price_record', {
      priceRecordId: typo.id,
      date: '2026-03-05',
      channelId: other.id,
      purchased: false,
      listPrice: 9000,
      discounts: [{ amount: 3000, name: '满减' }],
      quantity: 20,
      size: { amount: 65, unit: sheet },
      note: '会员价',
    });
    const expected = {
      id: typo.id,
      date: '2026-03-05',
      channel: { id: other.id },
      purchased: false,
      listPrice: 9000,
      discounts: [{ amount: 3000, name: '满减' }],
      quantity: 20,
      enteredSize: { amount: 65, unit: { name: '抽' } },
      note: '会员价',
      netPrice: 6000,
      unitPrice: 600,
    };
    expect(priceRecord).toMatchObject(expected);
    expect(priceRecord).not.toHaveProperty('evidence');
    expect(await readRecord(m, typo.id)).toMatchObject(expected);

    const after = await call<{ lowestUnitPrice: number }>(client, 'get_product', { productId: s.product.id });
    expect(after.lowestUnitPrice).toBe(600);
    expect(await call(client, 'judge_price', quote)).toMatchObject({ verdict: null, lowestUnitPrice: 600 });

    // A full replace: discounts and note left out are cleared, not kept.
    await call(client, 'update_price_record', {
      priceRecordId: typo.id,
      date: '2026-03-05',
      channelId: other.id,
      purchased: false,
      listPrice: 9000,
      quantity: 20,
      size: { amount: 65, unit: sheet },
    });
    expect(await readRecord(m, typo.id)).toMatchObject({ discounts: [], note: '', unitPrice: 900 });
  });

  test('an omitted promotionId keeps the tag, as over HTTP, and null clears it', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const promotion = await post<{ id: string }>(m, '/api/promotions', {
      name: `双11 ${crypto.randomUUID().slice(0, 4)}`,
      startsOn: '11-01',
      endsOn: '11-11',
    });
    const record = await recordPrice(m, s, '2025-11-11', 5000, 10);
    expect((await readRecord(m, record.id)).promotion?.id).toBe(promotion.id);
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const input = {
      priceRecordId: record.id,
      channelId: s.channelId,
      purchased: true,
      listPrice: 5000,
      quantity: 10,
      size: { amount: 130, unit: sheet },
    };

    await call(client, 'update_price_record', { ...input, date: '2025-11-12' });
    expect((await readRecord(m, record.id)).promotion?.id).toBe(promotion.id);

    await call(client, 'update_price_record', { ...input, date: '2025-11-12', promotionId: null });
    expect((await readRecord(m, record.id)).promotion).toBeNull();
  });

  test('a size in another dimension or discounts that cover the price fail and change nothing', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const record = await recordPrice(m, s, '2026-03-01', 7000, 10);
    const before = await readRecord(m, record.id);
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const input = {
      priceRecordId: record.id,
      date: '2026-03-01',
      channelId: s.channelId,
      purchased: true,
      listPrice: 7000,
      quantity: 10,
      size: { amount: 130, unit: sheet },
    };

    expect(
      await callFails(client, 'update_price_record', {
        ...input,
        size: { amount: 1, unit: { dimension: 'weight', name: 'kg' } },
      }),
    ).toContain('单位');
    expect(await callFails(client, 'update_price_record', { ...input, discounts: [{ amount: 7000 }] })).toContain(
      '优惠',
    );
    expect(await readRecord(m, record.id)).toEqual(before);
  });

  test('delete_price_record deletes the record with its evidence', async () => {
    const m = await signUpHousehold(ctx);
    const s = await seedHousehold(m);
    const kept = await recordPrice(m, s, '2026-03-01', 7000, 10);
    const duplicate = await recordPrice(m, s, '2026-03-01', 7000, 10);
    const evidenceIds = await attachEvidence(m, duplicate.id);
    const { client } = await connectAsClaude(ctx.baseUrl, m);

    expect(await call(client, 'delete_price_record', { priceRecordId: duplicate.id })).toEqual({
      deletedId: duplicate.id,
    });
    expect((await m.request(`/api/price-records/${duplicate.id}`)).status).toBe(404);
    for (const id of evidenceIds) {
      expect((await m.request(`/api/evidence/${id}`)).status).toBe(404);
      expect(existsSync(path.join(ctx.evidenceDir, id))).toBe(false);
    }
    expect((await listRecords(m, s.product.id)).map((r) => r.id)).toEqual([kept.id]);
    expect(await callFails(client, 'delete_price_record', { priceRecordId: duplicate.id })).toContain('价格记录');
  });

  test("another household's price records are not found and stay as they were, evidence included", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const own = await seedHousehold(alice);
    const others = await seedHousehold(bob);
    const ownRecord = await recordPrice(alice, own, '2026-03-01', 7000, 10);
    const bobsRecord = await recordPrice(bob, others, '2026-03-01', 7000, 10);
    const bobsEvidence = await attachEvidence(bob, bobsRecord.id);
    const bobsBefore = await readRecord(bob, bobsRecord.id);
    const ownBefore = await readRecord(alice, ownRecord.id);
    const { client } = await connectAsClaude(ctx.baseUrl, alice);
    const input = {
      date: '2026-03-02',
      purchased: false,
      listPrice: 100,
      quantity: 1,
      size: { amount: 130, unit: sheet },
    };

    expect(
      await callFails(client, 'update_price_record', {
        ...input,
        priceRecordId: bobsRecord.id,
        channelId: own.channelId,
      }),
    ).toContain('价格记录');
    expect(
      await callFails(client, 'update_price_record', {
        ...input,
        priceRecordId: ownRecord.id,
        channelId: others.channelId,
      }),
    ).toContain('渠道');
    expect(await callFails(client, 'delete_price_record', { priceRecordId: bobsRecord.id })).toContain('价格记录');

    expect(await readRecord(bob, bobsRecord.id)).toEqual(bobsBefore);
    for (const id of bobsEvidence) {
      expect((await bob.request(`/api/evidence/${id}`)).status).toBe(200);
      expect(existsSync(path.join(ctx.evidenceDir, id))).toBe(true);
    }
    expect(await readRecord(alice, ownRecord.id)).toEqual(ownBefore);
  });
});

interface AuthorizedClient {
  clientId: string;
  name: string | null;
  uri: string | null;
  scopes: string[];
  authorizedAt: string;
}

const listAuthorizedClients = async (m: SignedInMember) => {
  const res = await m.request('/api/mcp-clients');
  expect(res.status).toBe(200);
  return (await res.json()) as AuthorizedClient[];
};

const revoke = (m: SignedInMember, clientId: string) =>
  m.request(`/api/mcp-clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' });

describe('authorized MCP clients', () => {
  test('a member sees the clients they authorized', async () => {
    const m = await signUpHousehold(ctx);
    expect(await listAuthorizedClients(m)).toEqual([]);
    await authorizeAsClaude(ctx.baseUrl, m, { scope: allScopes });

    expect(await listAuthorizedClients(m)).toEqual([
      {
        clientId: CLAUDE_CLIENT_ID,
        name: 'Claude',
        uri: 'https://claude.ai',
        scopes: expect.arrayContaining(['stockup:read', 'stockup:write']),
        authorizedAt: expect.any(String),
      },
    ]);
  });

  test('a revoked access token fails at once, and so does its refresh token', async () => {
    const m = await signUpHousehold(ctx);
    const { accessToken, refreshToken } = await authorizeAsClaude(ctx.baseUrl, m, { scope: allScopes });
    expect((await listTools({ authorization: `Bearer ${accessToken}` })).status).toBe(200);
    expect(refreshToken).toBeTruthy();

    expect((await revoke(m, CLAUDE_CLIENT_ID)).status).toBe(204);
    expect(await listAuthorizedClients(m)).toEqual([]);

    const res = await listTools({ authorization: `Bearer ${accessToken}` });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
    const refreshed = await fetch(new URL('/api/auth/oauth2/token', ctx.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken!,
        client_id: CLAUDE_CLIENT_ID,
      }),
    });
    expect(refreshed.ok).toBe(false);
  });

  test('a token issued before the revocation stays revoked after the member authorizes again', async () => {
    const m = await signUpHousehold(ctx);
    const revokedToken = (await authorizeAsClaude(ctx.baseUrl, m)).accessToken;
    expect((await revoke(m, CLAUDE_CLIENT_ID)).status).toBe(204);
    // Token issue times are in whole seconds.
    await Bun.sleep(1000);
    const renewed = await authorizeAsClaude(ctx.baseUrl, m);

    expect((await listTools({ authorization: `Bearer ${revokedToken}` })).status).toBe(401);
    expect((await listTools({ authorization: `Bearer ${renewed.accessToken}` })).status).toBe(200);
  });

  test('a member removed from the household can still revoke', async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);
    await authorizeAsClaude(ctx.baseUrl, member);
    expect((await admin.request(`/api/members/${member.userId}`, { method: 'DELETE' })).status).toBe(204);

    const signedIn = await fetch(
      new URL('/api/auth/sign-in/username', ctx.baseUrl),
      jsonRequest('POST', { username: member.username, password: member.password }),
    );
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const res = await fetch(new URL(`/api/mcp-clients/${encodeURIComponent(CLAUDE_CLIENT_ID)}`, ctx.baseUrl), {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(204);
  });

  test("revoking leaves other members' authorizations working", async () => {
    const admin = await signUpHousehold(ctx);
    const member = await joinHousehold(ctx, admin);
    const own = await authorizeAsClaude(ctx.baseUrl, admin);
    const theirs = await authorizeAsClaude(ctx.baseUrl, member);

    expect((await revoke(admin, CLAUDE_CLIENT_ID)).status).toBe(204);
    expect((await listTools({ authorization: `Bearer ${own.accessToken}` })).status).toBe(401);
    expect((await listTools({ authorization: `Bearer ${theirs.accessToken}` })).status).toBe(200);
    expect(await listAuthorizedClients(member)).toHaveLength(1);
  });

  test('revoking a client that was never authorized is not found, and signing in is required', async () => {
    const m = await signUpHousehold(ctx);
    expect((await revoke(m, CLAUDE_CLIENT_ID)).status).toBe(404);
    expect((await fetch(new URL('/api/mcp-clients', ctx.baseUrl))).status).toBe(401);
  });
});
