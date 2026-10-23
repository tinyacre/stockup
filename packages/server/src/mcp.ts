import { requireMcpAuth } from '@better-auth/mcp';
import { createResourceServerChallenge } from '@better-auth/oauth-provider';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { IncompatibleUnitsError } from '@stockup/domain';
import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { z } from 'zod';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, mcpResource, type Auth } from './auth';
import {
  createCategory,
  createCategoryGroup,
  createProduct,
  deleteCategory,
  deleteCategoryGroup,
  deleteProduct,
  findProduct,
  listCatalog,
  mergeProducts,
  MergedProductNotFoundError,
  SameProductError,
  searchProducts,
  updateCategory,
  updateCategoryGroup,
  updateProduct,
} from './catalog';
import { createChannel, deleteChannel, listChannels, updateChannel } from './channels';
import type { Database } from './db';
import { NameTakenError, NotEmptyError, ParentNotFoundError } from './db/errors';
import type { EvidenceStore } from './evidence-store';
import { describePriceHistory, judgePrice } from './judgments';
import { findMcpGrant } from './mcp-clients';
import { findCurrentMember, type CurrentMember } from './members';
import {
  createPriceRecord,
  deletePriceRecord,
  InvalidPriceError,
  ProductNotFoundError,
  PromotionNotFoundError,
  replacePriceRecord,
} from './price-records';
import {
  atMostOnePlacement,
  catalogSchema,
  categoryChangesSchema,
  categoryGroupSchema,
  catalogNameSchema,
  categorySchema,
  missingPlacement,
  newProductSchema,
  productChangesSchema,
  productSchema,
  twoPlacements,
} from './routes/catalog';
import { hasChanges, nothingToChange } from './routes/changes';
import { channelChangesSchema, channelNameSchema, channelSchema } from './routes/channels';
import { judgmentInputSchema, judgmentSchema } from './routes/judgments';
import { priceRecordInputSchema, priceRecordSchema } from './routes/price-records';

const failure = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });

const noHousehold = failure('你已不属于任何家庭，无法访问 StockUp 的数据。请向家庭管理员要一个邀请链接重新加入。');

const productNotFound = '这个家庭没有这个商品，请先用 search_products 找到商品 ID。';
const channelNotFound = '这个家庭没有这个渠道，请先用 list_channels 找到渠道 ID。';
const categoryGroupNotFound = '这个家庭没有这个大类，请先用 list_categories 找到大类 ID。';
const categoryNotFound = '这个家庭没有这个品类，请先用 list_categories 找到品类 ID。';
const placementNotFound = { category_group_not_found: categoryGroupNotFound, category_not_found: categoryNotFound };
const priceRecordNotFound = '这个家庭没有这条价格记录，请先用 get_product 找到价格记录 ID。';

// The same domain error means different things per tool, so each tool supplies its own sentence.
interface FailureSentences {
  missingParent?: string;
  nameTaken?: string;
  notEmpty?: string;
  incompatibleUnits?: string;
}

// The assistant relays these to the member, so they say what to change rather than name the error.
function describeFailure(error: unknown, { missingParent, nameTaken, notEmpty, incompatibleUnits }: FailureSentences) {
  if (error instanceof ProductNotFoundError) return productNotFound;
  if (error instanceof ParentNotFoundError && missingParent) return missingParent;
  if (error instanceof NameTakenError && nameTaken) return nameTaken;
  if (error instanceof NotEmptyError && notEmpty) return notEmpty;
  if (error instanceof PromotionNotFoundError) return '这个家庭没有这个大促，请省略 promotionId 让系统按日期自动标注。';
  if (error instanceof SameProductError) return '要合并的两个商品是同一个，请用 search_products 找到重复的那一个。';
  if (error instanceof MergedProductNotFoundError) {
    return '这个家庭没有要合并的商品，请先用 search_products 找到重复商品的 ID。';
  }
  if (error instanceof IncompatibleUnitsError) {
    return (
      incompatibleUnits ??
      `规格的单位 ${error.from.name} 无法换算成商品的计价单位 ${error.to.name}，请用同一量纲的单位；计数单位须与计价单位同名。`
    );
  }
  if (error instanceof InvalidPriceError) return '优惠合计不能达到或超过原价。';
  return undefined;
}

const sizeHelp =
  'size is the amount per piece in any unit of the same dimension as the pricing unit (g, kg, 斤, 磅 or ml, L); a count unit must be named exactly as the pricing unit. quantity counts the pieces, free gifts included: 3 提 × 6 包 of 130 抽 is quantity 18 of 130 抽.';
const centsHelp = 'Every price is in cents: 99 元 is 9900.';

const mcpPriceRecordSchema = priceRecordSchema.omit({ evidence: true });
const discounts = priceRecordInputSchema.shape.discounts.default([]);

// The tools act as the member the access token was issued to. Their household is looked up on every
// call, so the token never carries it and leaving a household takes effect before the token expires.
function stockupServer(db: Database, store: EvidenceStore, userId: string, scopes: string[]) {
  const server = new McpServer({ name: 'stockup', version: '0.1.0' });

  async function asMember<T extends Record<string, unknown>>(
    run: (member: CurrentMember) => Promise<T | string>,
    sentences: FailureSentences = {},
  ) {
    const member = await findCurrentMember(db, userId);
    if (!member) return noHousehold;
    try {
      const result = await run(member);
      if (typeof result === 'string') return failure(result);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const message = describeFailure(error, sentences);
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
      description:
        "List the household's channels, the places it buys from, by name. Archived channels are no longer in use, so record new prices through unarchived ones.",
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
      description:
        "List the household's category groups with their categories and how many products each holds; a group's own count is of products outside any category.",
      inputSchema: z.object({}),
      outputSchema: z.object({ categoryGroups: catalogSchema }),
      annotations: readOnly,
    },
    () => asMember(async (member) => ({ categoryGroups: await listCatalog(db, member) })),
  );

  if (!scopes.includes(MCP_WRITE_SCOPE)) return server;

  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    'create_product',
    {
      title: 'Create a product',
      description:
        'Create a product in one of the categories list_categories returns, or with categoryGroupId directly in a category group when no category fits. Search first: a product is a brand and line sharing one stock line, such as 得宝抽纸 M 码, and scents or colours of it are the same product. baseSize, in the pricing unit, is the reference amount unit prices are shown for, such as 90 抽 or 500 g.',
      inputSchema: newProductSchema,
      outputSchema: z.object({ product: productSchema }),
      annotations: write,
    },
    (input) =>
      asMember(async (member) => ({ product: await createProduct(db, member, input) }), {
        missingParent: placementNotFound[missingPlacement(input)],
        nameTaken: '这个家庭已经有同名的商品。',
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
        { missingParent: channelNotFound },
      ),
  );

  const channelNameTaken = '这个家庭已经有同名的渠道，请改用 list_channels 里已有的那一个，或换一个名字。';

  server.registerTool(
    'create_channel',
    {
      title: 'Create a channel',
      description:
        'Create a channel, a place the household buys from such as 京东自营 or 山姆. Check list_channels with includeArchived first, and restore an archived channel with update_channel instead of creating it again.',
      inputSchema: z.object({ name: channelNameSchema }),
      outputSchema: z.object({ channel: channelSchema }),
      annotations: write,
    },
    (input) =>
      asMember(async (member) => ({ channel: await createChannel(db, member, input) }), {
        nameTaken: channelNameTaken,
      }),
  );

  server.registerTool(
    'update_channel',
    {
      title: 'Update a channel',
      description:
        'Rename a channel, archive one no longer in use so it leaves the default list_channels, or restore an archived one. Its price records keep pointing at it either way.',
      inputSchema: z
        .object({ channelId: z.string(), ...channelChangesSchema.shape })
        .refine(({ channelId, ...changes }) => hasChanges(changes), nothingToChange),
      outputSchema: z.object({ channel: channelSchema }),
      annotations: write,
    },
    ({ channelId, ...changes }) =>
      asMember(
        async (member) => {
          const channel = await updateChannel(db, member, channelId, changes);
          return channel ? { channel } : channelNotFound;
        },
        { nameTaken: channelNameTaken },
      ),
  );

  server.registerTool(
    'delete_channel',
    {
      title: 'Delete a channel',
      description: 'Delete a channel that no price record names, such as one created by mistake.',
      inputSchema: z.object({ channelId: z.string() }),
      outputSchema: z.object({ deletedId: z.string() }),
      annotations: destructive,
    },
    ({ channelId }) =>
      asMember(
        async (member) => ((await deleteChannel(db, member, channelId)) ? { deletedId: channelId } : channelNotFound),
        { notEmpty: '还有价格记录使用这个渠道，无法删除；可以用 update_channel 改为归档。' },
      ),
  );

  const categoryGroupNameTaken = '这个家庭已经有同名的大类，请改用 list_categories 里已有的那一个，或换一个名字。';
  const categoryNameTaken = '这个家庭已经有同名的品类，请改用 list_categories 里已有的那一个，或换一个名字。';

  server.registerTool(
    'create_category_group',
    {
      title: 'Create a category group',
      description:
        'Create a category group, the top level of the catalog such as 生活用品 or 食品. Check list_categories first.',
      inputSchema: z.object({ name: catalogNameSchema }),
      outputSchema: z.object({ categoryGroup: categoryGroupSchema }),
      annotations: write,
    },
    (input) =>
      asMember(async (member) => ({ categoryGroup: await createCategoryGroup(db, member, input) }), {
        nameTaken: categoryGroupNameTaken,
      }),
  );

  server.registerTool(
    'update_category_group',
    {
      title: 'Rename a category group',
      description: 'Rename a category group.',
      inputSchema: z.object({ categoryGroupId: z.string(), name: catalogNameSchema }),
      outputSchema: z.object({ categoryGroup: categoryGroupSchema }),
      annotations: write,
    },
    ({ categoryGroupId, name }) =>
      asMember(
        async (member) => {
          const categoryGroup = await updateCategoryGroup(db, member, categoryGroupId, { name });
          return categoryGroup ? { categoryGroup } : categoryGroupNotFound;
        },
        { nameTaken: categoryGroupNameTaken },
      ),
  );

  server.registerTool(
    'delete_category_group',
    {
      title: 'Delete a category group',
      description: 'Delete a category group that holds no categories and no products.',
      inputSchema: z.object({ categoryGroupId: z.string() }),
      outputSchema: z.object({ deletedId: z.string() }),
      annotations: destructive,
    },
    ({ categoryGroupId }) =>
      asMember(
        async (member) => {
          const deleted = await deleteCategoryGroup(db, member, categoryGroupId);
          return deleted ? { deletedId: categoryGroupId } : categoryGroupNotFound;
        },
        { notEmpty: '这个大类里还有品类或商品，无法删除；请先把它们移走或删除。' },
      ),
  );

  server.registerTool(
    'create_category',
    {
      title: 'Create a category',
      description:
        'Create a category, such as 纸品, in one of the category groups list_categories returns. Check list_categories first.',
      inputSchema: z.object({ categoryGroupId: z.string(), name: catalogNameSchema }),
      outputSchema: z.object({ category: categorySchema }),
      annotations: write,
    },
    (input) =>
      asMember(async (member) => ({ category: await createCategory(db, member, input) }), {
        missingParent: categoryGroupNotFound,
        nameTaken: categoryNameTaken,
      }),
  );

  server.registerTool(
    'update_category',
    {
      title: 'Update a category',
      description: 'Rename a category or move it, with its products, to another category group.',
      inputSchema: z
        .object({ categoryId: z.string(), ...categoryChangesSchema.shape })
        .refine(({ categoryId, ...changes }) => hasChanges(changes), nothingToChange),
      outputSchema: z.object({ category: categorySchema }),
      annotations: write,
    },
    ({ categoryId, ...changes }) =>
      asMember(
        async (member) => {
          const category = await updateCategory(db, member, categoryId, changes);
          return category ? { category } : categoryNotFound;
        },
        { missingParent: categoryGroupNotFound, nameTaken: categoryNameTaken },
      ),
  );

  server.registerTool(
    'delete_category',
    {
      title: 'Delete a category',
      description: 'Delete a category that holds no products.',
      inputSchema: z.object({ categoryId: z.string() }),
      outputSchema: z.object({ deletedId: z.string() }),
      annotations: destructive,
    },
    ({ categoryId }) =>
      asMember(
        async (member) =>
          (await deleteCategory(db, member, categoryId)) ? { deletedId: categoryId } : categoryNotFound,
        { notEmpty: '这个品类里还有商品，无法删除；请先把商品移到其他品类或删除。' },
      ),
  );

  server.registerTool(
    'update_product',
    {
      title: 'Update a product',
      description: `Rename a product, move it to another category or with categoryGroupId directly into a category group, change its note, pricing unit, base size or stock line, or archive it so it leaves search by default, or restore it. A new pricing unit must be of the same dimension (g to kg); every price record's size is converted to it. stockLine is in cents per base size and null clears it; without a new stock line, a new base size scales the stock line along.`,
      inputSchema: z
        .object({ productId: z.string(), ...productChangesSchema.shape })
        .refine(({ productId, ...changes }) => hasChanges(changes), nothingToChange)
        .refine(atMostOnePlacement, twoPlacements),
      outputSchema: z.object({ product: productSchema }),
      annotations: write,
    },
    ({ productId, ...changes }) =>
      asMember(
        async (member) => {
          const product = await updateProduct(db, member, productId, changes);
          return product ? { product } : productNotFound;
        },
        {
          missingParent: placementNotFound[missingPlacement(changes)],
          incompatibleUnits:
            '计价单位只能换成同一量纲的单位（如 g 换成 kg），计数单位不能改名；需要换量纲或计数单位时，请新建一个商品。',
        },
      ),
  );

  server.registerTool(
    'merge_products',
    {
      title: 'Merge duplicate products',
      description:
        "Merge a duplicate into the product to keep: every price record of duplicateProductId moves to productId, its size converted to the kept product's pricing unit, and the duplicate is deleted. The kept product's name, placement, base size and stock line stay as they are. Both must be priced in units of the same dimension.",
      inputSchema: z.object({
        productId: z.string().describe('The product to keep'),
        duplicateProductId: z.string().describe('The duplicate to merge and delete'),
      }),
      outputSchema: z.object({ product: productSchema }),
      annotations: destructive,
    },
    ({ productId, duplicateProductId }) =>
      asMember(
        async (member) => {
          const product = await mergeProducts(db, member, productId, duplicateProductId);
          return product ? { product } : productNotFound;
        },
        {
          incompatibleUnits:
            '两个商品的计价单位无法换算（量纲不同，或计数单位不同名），不能合并；可以先用 update_product 归档重复的那一个。',
        },
      ),
  );

  server.registerTool(
    'delete_product',
    {
      title: 'Delete a product',
      description:
        'Delete a product that has no price records, such as one created by mistake. Archive one no longer bought with update_product, or merge a duplicate with merge_products.',
      inputSchema: z.object({ productId: z.string() }),
      outputSchema: z.object({ deletedId: z.string() }),
      annotations: destructive,
    },
    ({ productId }) =>
      asMember(
        async (member) => ((await deleteProduct(db, member, productId)) ? { deletedId: productId } : productNotFound),
        {
          notEmpty:
            '这个商品还有价格记录，无法删除；可以用 update_product 改为归档，重复的商品可以用 merge_products 合并到另一个。',
        },
      ),
  );

  server.registerTool(
    'update_price_record',
    {
      title: 'Correct a price record',
      description: `Replace every field of a price record get_product lists, to correct a wrong date, channel, price, discounts, quantity, size, purchase, promotion or note; its product stays. Pass every field as it should end up: discounts and note left out are cleared. ${centsHelp} listPrice is the total before discounts. ${sizeHelp} Omit promotionId to keep the record's promotion, or pass null to clear it.`,
      inputSchema: priceRecordInputSchema.extend({ priceRecordId: z.string(), discounts }),
      outputSchema: z.object({ priceRecord: mcpPriceRecordSchema }),
      annotations: write,
    },
    ({ priceRecordId, ...input }) =>
      asMember(
        async (member) => {
          const replaced = await replacePriceRecord(db, member, priceRecordId, input);
          if (!replaced) return priceRecordNotFound;
          const { evidence, ...priceRecord } = replaced;
          return { priceRecord };
        },
        { missingParent: channelNotFound },
      ),
  );

  server.registerTool(
    'delete_price_record',
    {
      title: 'Delete a price record',
      description:
        'Delete a price record get_product lists, such as a duplicate or one recorded by mistake, together with its screenshots. Correct a wrong field with update_price_record instead.',
      inputSchema: z.object({ priceRecordId: z.string() }),
      outputSchema: z.object({ deletedId: z.string() }),
      annotations: destructive,
    },
    ({ priceRecordId }) =>
      asMember(async (member) =>
        (await deletePriceRecord(db, store, member, priceRecordId))
          ? { deletedId: priceRecordId }
          : priceRecordNotFound,
      ),
  );

  return server;
}

export function mcpRoutes(db: Database, auth: Auth, store: EvidenceStore) {
  const resource = mcpResource(auth.options.baseURL);
  // Asks clients for both scopes up front; a token with only the read scope still reaches the read tools.
  const challengeScopes = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];
  const handler = createMcpHandler(
    ({ authInfo }) => stockupServer(db, store, String(authInfo?.extra?.sub), authInfo?.scopes ?? []),
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
