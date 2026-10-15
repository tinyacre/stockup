import { requireMcpAuth } from '@better-auth/mcp';
import { createResourceServerChallenge } from '@better-auth/oauth-provider';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { IncompatibleUnitsError } from '@stockup/domain';
import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { z } from 'zod';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, mcpResource, type Auth } from './auth';
import { createProduct, findProduct, listCatalog, searchProducts } from './catalog';
import { listChannels } from './channels';
import type { Database } from './db';
import { NameTakenError, ParentNotFoundError } from './db/errors';
import { describePriceHistory, judgePrice } from './judgments';
import { findMcpGrant } from './mcp-clients';
import { findCurrentMember, type CurrentMember } from './members';
import {
  createPriceRecord,
  InvalidPriceError,
  ProductNotFoundError,
  PromotionNotFoundError,
} from './price-records';
import { catalogSchema, newProductSchema, productSchema } from './routes/catalog';
import { channelSchema } from './routes/channels';
import { judgmentInputSchema, judgmentSchema } from './routes/judgments';
import { priceRecordInputSchema, priceRecordSchema } from './routes/price-records';

const failure = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });

const noHousehold = failure(
  '你已不属于任何家庭，无法访问 StockUp 的数据。请向家庭管理员要一个邀请链接重新加入。',
);

const productNotFound = '这个家庭没有这个商品，请先用 search_products 找到商品 ID。';

// The assistant relays these to the member, so they say what to change rather than name the error.
function describeFailure(error: unknown, missingParent: string | undefined) {
  if (error instanceof ProductNotFoundError) return productNotFound;
  if (error instanceof ParentNotFoundError && missingParent) return missingParent;
  if (error instanceof PromotionNotFoundError) return '这个家庭没有这个大促，请省略 promotionId 让系统按日期自动标注。';
  if (error instanceof IncompatibleUnitsError) {
    return `规格的单位 ${error.from.name} 无法换算成商品的计价单位 ${error.to.name}，请用同一量纲的单位；计数单位须与计价单位同名。`;
  }
  if (error instanceof InvalidPriceError) return '优惠合计不能达到或超过原价。';
  if (error instanceof NameTakenError) return '这个家庭已经有同名的商品。';
  return undefined;
}

const sizeHelp =
  'size is the amount per piece in any unit of the same dimension as the pricing unit (g, kg, 斤, 磅 or ml, L); a count unit must be named exactly as the pricing unit. quantity counts the pieces, free gifts included: 3 提 × 6 包 of 130 抽 is quantity 18 of 130 抽.';
const centsHelp = 'Every price is in cents: 99 元 is 9900.';

const mcpPriceRecordSchema = priceRecordSchema.omit({ evidence: true });
const discounts = priceRecordInputSchema.shape.discounts.default([]);

// The tools act as the member the access token was issued to. Their household is looked up on every
// call, so the token never carries it and leaving a household takes effect before the token expires.
function stockupServer(db: Database, userId: string, scopes: string[]) {
  const server = new McpServer({ name: 'stockup', version: '0.1.0' });

  async function asMember<T extends Record<string, unknown>>(
    run: (member: CurrentMember) => Promise<T | string>,
    { missingParent }: { missingParent?: string } = {},
  ) {
    const member = await findCurrentMember(db, userId);
    if (!member) return noHousehold;
    try {
      const result = await run(member);
      if (typeof result === 'string') return failure(result);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const message = describeFailure(error, missingParent);
      if (message === undefined) throw error;
      return failure(message);
    }
  }

  const readOnly = { readOnlyHint: true, openWorldHint: false };

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
      annotations: readOnly,
    },
    ({ query, includeArchived, limit }) =>
      asMember(async (member) => ({ products: await searchProducts(db, member, { query, includeArchived, limit }) })),
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get a product',
      description:
        "Describe a product with its price records newest first, its stock line (入手价, cents per base size, null when unset), the lowest unit price across its records and the lowest unit price under each promotion by year. Unit prices are in cents per base size; a record's enteredSize is the size as it was entered.",
      inputSchema: z.object({
        productId: z.string(),
        limit: z.number().int().min(1).max(200).default(20).describe('How many of the newest price records to list'),
      }),
      outputSchema: z.object({
        product: productSchema,
        lowestUnitPrice: z.number().nullable(),
        promotionLowests: z.array(
          z.object({
            promotion: z.object({ id: z.string(), name: z.string() }),
            year: z.number().int(),
            lowestUnitPrice: z.number(),
          }),
        ),
        priceRecordCount: z.number().int(),
        priceRecords: z.array(mcpPriceRecordSchema),
      }),
      annotations: readOnly,
    },
    ({ productId, limit }) =>
      asMember(async (member) => {
        const [product, { records, lowestUnitPrice, promotionLowests }] = await Promise.all([
          findProduct(db, member, productId),
          describePriceHistory(db, member, productId),
        ]);
        if (!product) return productNotFound;
        return {
          product,
          lowestUnitPrice,
          promotionLowests,
          priceRecordCount: records.length,
          priceRecords: records.slice(0, limit).map(({ evidence, ...record }) => record),
        };
      }),
  );

  server.registerTool(
    'judge_price',
    {
      title: 'Judge a price',
      description: `Price a quote for a product and judge whether it is worth stocking up on, storing nothing. ${centsHelp} listPrice is the total before discounts. ${sizeHelp} The verdict is recordLow below the lowest unit price, stockUp at or below the stock line, skip above it, noReference with neither, or null without a stock line when it is not a record low. date picks the promotion to compare with last year's and defaults to today.`,
      inputSchema: judgmentInputSchema.extend({ discounts }),
      outputSchema: judgmentSchema,
      annotations: readOnly,
    },
    (input) => asMember((member) => judgePrice(db, member, input)),
  );

  server.registerTool(
    'list_channels',
    {
      title: 'List channels',
      description: "List the household's channels, the places it buys from, by name.",
      inputSchema: z.object({ includeArchived: z.boolean().default(false).describe('Also list archived channels') }),
      outputSchema: z.object({ channels: z.array(channelSchema) }),
      annotations: readOnly,
    },
    ({ includeArchived }) =>
      asMember(async (member) => ({ channels: await listChannels(db, member, { includeArchived }) })),
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description: "List the household's category groups with their categories and how many products each holds.",
      inputSchema: z.object({}),
      outputSchema: z.object({ categoryGroups: catalogSchema }),
      annotations: readOnly,
    },
    () => asMember(async (member) => ({ categoryGroups: await listCatalog(db, member) })),
  );

  if (!scopes.includes(MCP_WRITE_SCOPE)) return server;

  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    'create_product',
    {
      title: 'Create a product',
      description:
        'Create a product in one of the categories list_categories returns. Search first: a product is a brand and line sharing one stock line, such as 得宝抽纸 M 码, and scents or colours of it are the same product. baseSize, in the pricing unit, is the reference amount unit prices are shown for, such as 90 抽 or 500 g.',
      inputSchema: newProductSchema,
      outputSchema: z.object({ product: productSchema }),
      annotations: write,
    },
    (input) =>
      asMember(async (member) => ({ product: await createProduct(db, member, input) }), {
        missingParent: '这个家庭没有这个品类，请先用 list_categories 找到品类 ID。',
      }),
  );

  server.registerTool(
    'create_price_record',
    {
      title: 'Record a price',
      description: `Record a price the member paid (purchased true) or only saw (purchased false) for a product, through a channel list_channels returns. ${centsHelp} listPrice is the total before discounts. ${sizeHelp} Omit promotionId to tag the promotion the date falls in.`,
      inputSchema: priceRecordInputSchema.extend({ productId: z.string(), discounts }),
      outputSchema: z.object({ priceRecord: mcpPriceRecordSchema }),
      annotations: write,
    },
    (input) =>
      asMember(
        async (member) => {
          const { evidence, ...priceRecord } = await createPriceRecord(db, member, input, 'mcp');
          return { priceRecord };
        },
        { missingParent: '这个家庭没有这个渠道，请先用 list_channels 找到渠道 ID。' },
      ),
  );

  return server;
}

export function mcpRoutes(db: Database, auth: Auth) {
  const resource = mcpResource(auth.options.baseURL);
  // Asks clients for both scopes up front; a token with only the read scope still reaches the read tools.
  const challengeScopes = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];
  const handler = createMcpHandler(
    ({ authInfo }) => stockupServer(db, String(authInfo?.extra?.sub), authInfo?.scopes ?? []),
    { onerror: (error) => console.error('MCP request failed', error) },
  );

  const revoked = () => {
    const challenge = createResourceServerChallenge(
      new APIError('UNAUTHORIZED', { message: 'The member revoked this client' }),
      resource,
      { challengeScopes },
    )!;
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32000, message: challenge.message }, id: null },
      { status: 401, headers: challenge.headers },
    );
  };

  const protectedHandler = requireMcpAuth(
    auth,
    async (request, claims) => {
      const userId = String(claims.sub);
      const clientId = String(claims.azp ?? claims.client_id ?? '');
      // Access tokens are JWTs verified without a database lookup, so each request checks the member's
      // consent. A token issued before the consent was granted belongs to one the member revoked, and
      // scopes the member has since withdrawn no longer apply.
      const grant = await findMcpGrant(db, userId, clientId);
      if (!grant || Number(claims.iat) < Math.floor(grant.createdAt.getTime() / 1000)) return revoked();
      const tokenScopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
      return handler.fetch(request, {
        authInfo: {
          token: request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '',
          clientId,
          scopes: tokenScopes.filter((scope) => grant.scopes.includes(scope)),
          expiresAt: claims.exp,
          extra: { sub: userId },
        },
      });
    },
    // Both default to the auth base URL (/api/auth), which is neither the token audience nor where the
    // protected resource metadata is served; without required scopes any token would reach the tools.
    { resource, requiredScopes: [MCP_READ_SCOPE], challengeScopes },
  );
  return new Hono().all('/mcp', (c) => protectedHandler(c.req.raw));
}
