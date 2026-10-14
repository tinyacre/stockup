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
    expect(tools.map((t) => t.name)).toEqual(['search_products']);
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
