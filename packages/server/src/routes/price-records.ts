import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { IncompatibleUnitsError } from '@stockup/domain';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { ParentNotFoundError } from '../db/errors';
import { requireMember } from '../members';
import {
  createPriceRecord,
  deletePriceRecord,
  findPriceRecord,
  InvalidPriceError,
  listPriceRecords,
  ProductNotFoundError,
  replacePriceRecord,
} from '../price-records';
import { pricingUnitSchema } from './catalog';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const idParams = z.object({ id: z.string() });

// Postgres integer columns hold amounts up to 2^31 - 1.
const cents = z.number().int().positive().max(2_000_000_000);

const sizeSchema = z
  .object({ amount: z.number().positive().finite(), unit: pricingUnitSchema })
  .openapi('Size', { description: 'Amount per piece, in any unit of the same dimension as the pricing unit' });

const discountSchema = z
  .object({
    amount: cents.openapi({ description: 'Cents' }),
    name: z.string().trim().max(50).optional(),
  })
  .openapi('Discount');

const priceRecordInputSchema = z.object({
  date: z.iso.date(),
  channelId: z.string(),
  purchased: z.boolean().openapi({ description: 'Bought (true) or only seen (false)' }),
  listPrice: cents.openapi({ description: 'Total before discounts, in cents' }),
  discounts: z.array(discountSchema).max(20),
  quantity: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .openapi({ description: 'Number of pieces, free gifts included' }),
  size: sizeSchema,
  note: z.string().trim().max(500).optional(),
});

const priceRecordSchema = z
  .object({
    id: z.string(),
    productId: z.string(),
    date: z.string(),
    channel: z.object({ id: z.string(), name: z.string(), archived: z.boolean() }),
    purchased: z.boolean(),
    listPrice: z.number().int(),
    discounts: z.array(z.object({ amount: z.number().int(), name: z.string().optional() })),
    quantity: z.number().int(),
    size: sizeSchema.openapi({ description: 'Size converted to the pricing unit' }),
    enteredSize: sizeSchema.openapi({ description: 'Size as it was entered' }),
    note: z.string(),
    recordedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    source: z.enum(['manual', 'recognition', 'mcp']),
    netPrice: z.number().int().openapi({ description: 'List price minus discounts, in cents' }),
    unitPrice: z.number().openapi({ description: 'Net price per base size of the product, in cents' }),
  })
  .openapi('PriceRecord');

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

function respondToError(c: Context, error: unknown) {
  if (error instanceof ProductNotFoundError) return c.json({ error: 'product_not_found' }, 422);
  if (error instanceof ParentNotFoundError) return c.json({ error: 'channel_not_found' }, 422);
  if (error instanceof IncompatibleUnitsError) return c.json({ error: 'incompatible_unit' }, 422);
  if (error instanceof InvalidPriceError) return c.json({ error: 'invalid_price' }, 422);
  throw error;
}

export function priceRecordRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db);
  const unauthenticated = { 401: { description: 'Not signed in' } };
  const notFound = { 404: { description: 'No such price record in this household', content: errorContent } };
  const unprocessable = {
    422: {
      description:
        'The product or channel is not in this household (product_not_found, channel_not_found), the size cannot be converted to the pricing unit (incompatible_unit), or the discounts leave nothing to pay (invalid_price)',
      content: errorContent,
    },
  };
  const recordContent = { 'application/json': { schema: priceRecordSchema } };

  const listRoute = createRoute({
    method: 'get',
    path: '/price-records',
    tags: ['price records'],
    summary: "List a product's price records, newest first",
    middleware,
    request: { query: z.object({ productId: z.string() }) },
    responses: {
      200: { description: 'Price records', content: { 'application/json': { schema: z.array(priceRecordSchema) } } },
      ...unauthenticated,
    },
  });

  const getRoute = createRoute({
    method: 'get',
    path: '/price-records/{id}',
    tags: ['price records'],
    summary: 'Get a price record',
    middleware,
    request: { params: idParams },
    responses: { 200: { description: 'The price record', content: recordContent }, ...unauthenticated, ...notFound },
  });

  const createRecordRoute = createRoute({
    method: 'post',
    path: '/price-records',
    tags: ['price records'],
    summary: 'Record a price for a product',
    middleware,
    request: { body: json(priceRecordInputSchema.extend({ productId: z.string() })) },
    responses: { 201: { description: 'Created', content: recordContent }, ...unauthenticated, ...unprocessable },
  });

  const replaceRoute = createRoute({
    method: 'put',
    path: '/price-records/{id}',
    tags: ['price records'],
    summary: 'Replace every field of a price record but its product',
    middleware,
    request: { params: idParams, body: json(priceRecordInputSchema) },
    responses: {
      200: { description: 'Replaced', content: recordContent },
      ...unauthenticated,
      ...notFound,
      ...unprocessable,
    },
  });

  const deleteRoute = createRoute({
    method: 'delete',
    path: '/price-records/{id}',
    tags: ['price records'],
    summary: 'Delete a price record',
    middleware,
    request: { params: idParams },
    responses: { 204: { description: 'Deleted' }, ...unauthenticated, ...notFound },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => c.json(await listPriceRecords(db, c.var.member, c.req.valid('query')), 200))
    .openapi(getRoute, async (c) => {
      const found = await findPriceRecord(db, c.var.member, c.req.valid('param').id);
      return found ? c.json(found, 200) : c.json({ error: 'not_found' }, 404);
    })
    .openapi(createRecordRoute, async (c) => {
      try {
        return c.json(await createPriceRecord(db, c.var.member, c.req.valid('json')), 201);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(replaceRoute, async (c) => {
      try {
        const replaced = await replacePriceRecord(db, c.var.member, c.req.valid('param').id, c.req.valid('json'));
        return replaced ? c.json(replaced, 200) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(deleteRoute, async (c) => {
      const deleted = await deletePriceRecord(db, c.var.member, c.req.valid('param').id);
      return deleted ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
    });
}
