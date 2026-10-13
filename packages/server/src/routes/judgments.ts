import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { judgePrice } from '../judgments';
import { requireMember } from '../members';
import { priceRecordInputSchema, respondToError } from './price-records';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

const judgmentInputSchema = priceRecordInputSchema
  .pick({ listPrice: true, discounts: true, quantity: true, size: true })
  .extend({ productId: z.string() });

const unitPriceGap = z.number().nullable();

const judgmentSchema = z
  .object({
    netPrice: z.number().int().openapi({ description: 'List price minus discounts, in cents' }),
    unitPrice: z.number().openapi({ description: 'Net price per base size of the product, in cents' }),
    stockLine: z.number().int().nullable().openapi({ description: "The product's stock line, if set" }),
    lowestUnitPrice: z.number().nullable().openapi({ description: 'Lowest unit price across its price records' }),
    lastYearPromotionLowest: z
      .number()
      .nullable()
      .openapi({ description: "Lowest unit price in last year's same promotion; reserved, always null for now" }),
    verdict: z
      .enum(['recordLow', 'stockUp', 'skip', 'noReference'])
      .nullable()
      .openapi({
        description:
          'recordLow below the lowest unit price, stockUp at or below the stock line, skip above it, noReference with neither; null without a stock line when the price is not a record low',
      }),
    stockLineGap: unitPriceGap.openapi({ description: 'Percentage above (positive) or below (negative) the stock line' }),
    lowestGap: unitPriceGap.openapi({ description: 'Cents above (positive) or below (negative) the lowest unit price' }),
    lastYearPromotionGap: unitPriceGap.openapi({ description: "Cents above or below last year's promotion lowest" }),
  })
  .openapi('Judgment');

export function judgmentRoutes(db: Database, auth: Auth) {
  const judgeRoute = createRoute({
    method: 'post',
    path: '/judgments',
    tags: ['judgments'],
    summary: "Price a would-be record and judge its unit price against the product's references, storing nothing",
    middleware: requireMember(auth, db),
    request: { body: { content: { 'application/json': { schema: judgmentInputSchema } }, required: true } },
    responses: {
      200: { description: 'The judgment', content: { 'application/json': { schema: judgmentSchema } } },
      401: { description: 'Not signed in' },
      422: {
        description:
          'The product is not in this household (product_not_found), the size cannot be converted to the pricing unit (incompatible_unit), or the discounts leave nothing to pay (invalid_price)',
        content: errorContent,
      },
    },
  });

  return new OpenAPIHono().openapi(judgeRoute, async (c) => {
    try {
      return c.json(await judgePrice(db, c.var.member, c.req.valid('json')), 200);
    } catch (error) {
      return respondToError(c, error);
    }
  });
}
