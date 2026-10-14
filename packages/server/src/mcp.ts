import { requireMcpAuth } from '@better-auth/mcp';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { z } from 'zod';
import { MCP_TOOL_SCOPE, mcpResource, type Auth } from './auth';
import { searchProducts } from './catalog';
import type { Database } from './db';
import { findCurrentMember } from './members';
import { productSchema } from './routes/catalog';

const noHousehold = {
  isError: true,
  content: [{ type: 'text' as const, text: '你已不属于任何家庭，无法访问 StockUp 的数据。请向家庭管理员要一个邀请链接重新加入。' }],
};

// The tools act as the member the access token was issued to. Their household is looked up on every
// call, so the token never carries it and leaving a household takes effect before the token expires.
function stockupServer(db: Database, userId: string) {
  const server = new McpServer({ name: 'stockup', version: '0.1.0' });

  server.registerTool(
    'search_products',
    {
      title: 'Search products',
      description:
        "Search the household's products by name. Matches Chinese text, pinyin initials (dbcz finds 得宝抽纸), full pinyin and near misses such as a homophone or a wrong character, best match first. Stock lines are in cents per base size.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100),
        includeArchived: z.boolean().default(false).describe('Also search archived products'),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: z.object({ products: z.array(productSchema) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, includeArchived, limit }) => {
      const member = await findCurrentMember(db, userId);
      if (!member) return noHousehold;
      const products = await searchProducts(db, member, { query, includeArchived, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify(products) }],
        structuredContent: { products },
      };
    },
  );

  return server;
}

export function mcpRoutes(db: Database, auth: Auth) {
  const handler = createMcpHandler(({ authInfo }) => stockupServer(db, String(authInfo?.extra?.sub)), {
    onerror: (error) => console.error('MCP request failed', error),
  });
  const protectedHandler = requireMcpAuth(
    auth,
    (request, claims) =>
      handler.fetch(request, {
        authInfo: {
          token: request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '',
          clientId: String(claims.azp ?? claims.client_id ?? ''),
          scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
          expiresAt: claims.exp,
          extra: { sub: claims.sub },
        },
      }),
    // Both default to the auth base URL (/api/auth), which is neither the token audience nor where the
    // protected resource metadata is served; without required scopes any token would reach the tools.
    { resource: mcpResource(auth.options.baseURL), requiredScopes: [MCP_TOOL_SCOPE] },
  );
  return new Hono().all('/mcp', (c) => protectedHandler(c.req.raw));
}
