import { describe, expect, test } from 'bun:test';
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
const writeTools = ['create_product', 'create_price_record'];

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
  const category = await post<{ id: string }>(m, '/api/categories', { categoryGroupId: group.id, name: `纸品 ${suffix}` });
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
  test('offers nothing that deletes, merges, sets a stock line or manages members', async () => {
    const m = await signUpHousehold(ctx);
    const { client } = await connectAsClaude(ctx.baseUrl, m);
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.name).not.toMatch(/delete|remove|merge|update|replace|archive|member|invit|household|stock/);
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain('stockLine');
    }
    for (const tool of tools.filter((t) => readTools.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
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
    expect((await m.request(`/api/products/${s.product.id}`, jsonRequest('PATCH', { stockLine: 600 }))).status).toBe(200);
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
    expect((await m.request(`/api/products/${s.product.id}`, jsonRequest('PATCH', { stockLine: 600 }))).status).toBe(200);
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
    expect((await alice.request(`/api/channels/${archived.id}`, jsonRequest('PATCH', { archived: true }))).status).toBe(200);
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
      await callFails(client, 'create_price_record', { ...input, productId: others.product.id, channelId: own.channelId }),
      await callFails(client, 'create_price_record', { ...input, productId: own.product.id, channelId: others.channelId }),
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
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken!, client_id: CLAUDE_CLIENT_ID }),
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
    const cookie = signedIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
