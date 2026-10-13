import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { requireMember } from '../members';

const meSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    isInstanceAdmin: z.boolean(),
  }),
  household: z.object({ id: z.string(), name: z.string(), role: z.string() }),
});

export function meRoutes(db: Database, auth: Auth) {
  const route = createRoute({
    method: 'get',
    path: '/me',
    tags: ['members'],
    summary: 'Describe the signed-in member and their household',
    middleware: requireMember(auth, db),
    responses: {
      200: { description: 'The signed-in member', content: { 'application/json': { schema: meSchema } } },
      401: { description: 'Not signed in' },
    },
  });

  return new OpenAPIHono().openapi(route, (c) => {
    const m = c.var.member;
    return c.json(
      {
        user: { id: m.userId, username: m.username, name: m.name, isInstanceAdmin: m.isInstanceAdmin },
        household: { id: m.householdId, name: m.householdName, role: m.householdRole },
      },
      200,
    );
  });
}
