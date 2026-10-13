import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { requireMember } from '../members';
import { findPromotion, listPromotions } from '../promotions';

const promotionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    startsOn: z.string().openapi({ description: 'First day of the yearly range, MM-DD', example: '10-20' }),
    endsOn: z.string().openapi({ description: 'Last day of the yearly range, MM-DD', example: '11-11' }),
  })
  .openapi('Promotion');

const errorSchema = z.object({ error: z.string() });

export function promotionRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db);

  const listRoute = createRoute({
    method: 'get',
    path: '/promotions',
    tags: ['promotions'],
    summary: "List the household's promotions",
    middleware,
    responses: {
      200: { description: 'Promotions', content: { 'application/json': { schema: z.array(promotionSchema) } } },
      401: { description: 'Not signed in' },
    },
  });

  const getRoute = createRoute({
    method: 'get',
    path: '/promotions/{id}',
    tags: ['promotions'],
    summary: 'Get one of the household’s promotions',
    middleware,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'The promotion', content: { 'application/json': { schema: promotionSchema } } },
      401: { description: 'Not signed in' },
      404: {
        description: 'No such promotion in this household',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => c.json(await listPromotions(db, c.var.member), 200))
    .openapi(getRoute, async (c) => {
      const found = await findPromotion(db, c.var.member, c.req.valid('param').id);
      return found ? c.json(found, 200) : c.json({ error: 'not_found' }, 404);
    });
}
