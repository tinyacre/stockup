import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { isMonthDay } from '@stockup/domain';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { NameTakenError } from '../db/errors';
import { requireMember } from '../members';
import { createPromotion, findPromotion, listPromotions, updatePromotion } from '../promotions';
import { hasChanges, nothingToChange } from './changes';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const idParams = z.object({ id: z.string() });
const name = z.string().trim().min(1).max(50);
const monthDay = z.string().refine(isMonthDay, { message: 'Expected a month-day MM-DD' });

const promotionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    startsOn: z.string().openapi({ description: 'First day of the yearly range, MM-DD', example: '10-20' }),
    endsOn: z.string().openapi({
      description: 'Last day of the yearly range, MM-DD; before startsOn when the range spans the new year',
      example: '11-11',
    }),
  })
  .openapi('Promotion');

const promotionInputSchema = z.object({
  name,
  startsOn: monthDay.openapi({ example: '10-20' }),
  endsOn: monthDay.openapi({ example: '11-11' }),
});

const promotionChangesSchema = promotionInputSchema.partial().refine(hasChanges, nothingToChange);

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

function respondToError(c: Context, error: unknown) {
  if (error instanceof NameTakenError) return c.json({ error: 'name_taken' }, 409);
  throw error;
}

export function promotionRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db);
  const unauthenticated = { 401: { description: 'Not signed in' } };
  const notFound = { 404: { description: 'No such promotion in this household', content: errorContent } };
  const nameTaken = { 409: { description: 'The household already uses this name', content: errorContent } };
  const promotionContent = { 'application/json': { schema: promotionSchema } };

  const listRoute = createRoute({
    method: 'get',
    path: '/promotions',
    tags: ['promotions'],
    summary: "List the household's promotions",
    middleware,
    responses: {
      200: { description: 'Promotions', content: { 'application/json': { schema: z.array(promotionSchema) } } },
      ...unauthenticated,
    },
  });

  const getRoute = createRoute({
    method: 'get',
    path: '/promotions/{id}',
    tags: ['promotions'],
    summary: 'Get one of the household’s promotions',
    middleware,
    request: { params: idParams },
    responses: { 200: { description: 'The promotion', content: promotionContent }, ...unauthenticated, ...notFound },
  });

  const createPromotionRoute = createRoute({
    method: 'post',
    path: '/promotions',
    tags: ['promotions'],
    summary: 'Create a custom promotion',
    middleware,
    request: { body: json(promotionInputSchema) },
    responses: { 201: { description: 'Created', content: promotionContent }, ...unauthenticated, ...nameTaken },
  });

  const updateRoute = createRoute({
    method: 'patch',
    path: '/promotions/{id}',
    tags: ['promotions'],
    summary: 'Rename a promotion or change its range; tagged price records keep their tags',
    middleware,
    request: { params: idParams, body: json(promotionChangesSchema) },
    responses: {
      200: { description: 'Updated', content: promotionContent },
      ...unauthenticated,
      ...notFound,
      ...nameTaken,
    },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => c.json(await listPromotions(db, c.var.member), 200))
    .openapi(getRoute, async (c) => {
      const found = await findPromotion(db, c.var.member, c.req.valid('param').id);
      return found ? c.json(found, 200) : c.json({ error: 'not_found' }, 404);
    })
    .openapi(createPromotionRoute, async (c) => {
      try {
        return c.json(await createPromotion(db, c.var.member, c.req.valid('json')), 201);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(updateRoute, async (c) => {
      try {
        const updated = await updatePromotion(db, c.var.member, c.req.valid('param').id, c.req.valid('json'));
        return updated ? c.json(updated, 200) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    });
}
