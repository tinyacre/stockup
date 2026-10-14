import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { NameTakenError } from '../db/errors';
import { createHousehold, listHouseholds } from '../households';
import { requireInstanceAdmin } from '../members';
import { accountSchema, householdNameSchema } from './setup';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

const householdSchema = z
  .object({ id: z.string(), name: z.string(), memberCount: z.number().int(), createdAt: z.iso.datetime() })
  .openapi('Household');

export function householdRoutes(db: Database, auth: Auth) {
  const middleware = requireInstanceAdmin(auth);
  const instanceAdminOnly = {
    401: { description: 'Not signed in' },
    403: { description: 'Only the instance admin manages households', content: errorContent },
  };

  const listRoute = createRoute({
    method: 'get',
    path: '/households',
    tags: ['households'],
    summary: 'List every household on the instance, newest first',
    middleware,
    responses: {
      200: { description: 'Households', content: { 'application/json': { schema: z.array(householdSchema) } } },
      ...instanceAdminOnly,
    },
  });

  const createHouseholdRoute = createRoute({
    method: 'post',
    path: '/households',
    tags: ['households'],
    summary: 'Create a household with the preset promotions and a new account as its admin',
    middleware,
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: z.object({ householdName: householdNameSchema, admin: accountSchema }) },
        },
      },
    },
    responses: {
      201: {
        description: 'The household and its admin were created',
        content: { 'application/json': { schema: z.object({ userId: z.string(), householdId: z.string() }) } },
      },
      ...instanceAdminOnly,
      409: { description: "The admin's username is taken: username_taken", content: errorContent },
    },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => c.json(await listHouseholds(db), 200))
    .openapi(createHouseholdRoute, async (c) => {
      try {
        return c.json(await createHousehold(db, auth, c.req.valid('json')), 201);
      } catch (error) {
        if (error instanceof NameTakenError) return c.json({ error: 'username_taken' }, 409);
        throw error;
      }
    });
}
