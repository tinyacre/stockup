import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { AlreadySetUpError, needsSetup, setUpInstance } from '../onboarding';

const errorSchema = z.object({ error: z.string() });

// Mirrors Better Auth's default username and password rules, which sign-in applies.
const founderSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.]+$/),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(50),
  householdName: z.string().trim().min(1).max(50),
});

const statusRoute = createRoute({
  method: 'get',
  path: '/setup',
  tags: ['onboarding'],
  summary: 'Report whether the instance still needs its first member',
  responses: {
    200: {
      description: 'Setup status',
      content: { 'application/json': { schema: z.object({ needsSetup: z.boolean() }) } },
    },
  },
});

const setUpRoute = createRoute({
  method: 'post',
  path: '/setup',
  tags: ['onboarding'],
  summary: 'Create the first member, who administers the instance and the first household',
  description: 'Only succeeds on an empty instance. Signs the new member in.',
  request: { body: { required: true, content: { 'application/json': { schema: founderSchema } } } },
  responses: {
    201: {
      description: 'The founder and their household were created',
      content: { 'application/json': { schema: z.object({ userId: z.string(), householdId: z.string() }) } },
    },
    409: { description: 'The instance already has members', content: { 'application/json': { schema: errorSchema } } },
  },
});

export function setupRoutes(db: Database, auth: Auth) {
  return new OpenAPIHono()
    .openapi(statusRoute, async (c) => c.json({ needsSetup: await needsSetup(db) }, 200))
    .openapi(setUpRoute, async (c) => {
      const { username, password, name, householdName } = c.req.valid('json');
      let created;
      try {
        created = await setUpInstance(db, auth, { householdName, admin: { username, password, name } });
      } catch (error) {
        if (error instanceof AlreadySetUpError) return c.json({ error: 'already_set_up' }, 409);
        throw error;
      }

      const { headers } = await auth.api.signInUsername({ body: { username, password }, returnHeaders: true });
      for (const cookie of headers.getSetCookie()) c.header('set-cookie', cookie, { append: true });
      return c.json(created, 201);
    });
}
