import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { APIError } from 'better-auth/api';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { requireMember, type CurrentMember } from '../members';
import { accountSchema } from './setup';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

const meSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    isInstanceAdmin: z.boolean(),
  }),
  household: z.object({ id: z.string(), name: z.string(), role: z.string() }),
});

function toMe(m: CurrentMember) {
  return {
    user: { id: m.userId, username: m.username, name: m.name, isInstanceAdmin: m.isInstanceAdmin },
    household: { id: m.householdId, name: m.householdName, role: m.householdRole },
  };
}

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

export function meRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db);
  const unauthenticated = { 401: { description: 'Not signed in' } };

  const route = createRoute({
    method: 'get',
    path: '/me',
    tags: ['members'],
    summary: 'Describe the signed-in member and their household',
    middleware,
    responses: {
      200: { description: 'The signed-in member', content: { 'application/json': { schema: meSchema } } },
      ...unauthenticated,
    },
  });

  const renameRoute = createRoute({
    method: 'patch',
    path: '/me',
    tags: ['members'],
    summary: "Change the signed-in member's display name",
    description: 'Price records show the new name of the member who entered them.',
    middleware,
    request: { body: json(accountSchema.pick({ name: true })) },
    responses: {
      200: { description: 'The renamed member', content: { 'application/json': { schema: meSchema } } },
      ...unauthenticated,
    },
  });

  const passwordRoute = createRoute({
    method: 'post',
    path: '/me/password',
    tags: ['members'],
    summary: "Change the signed-in member's password",
    middleware,
    request: {
      body: json(z.object({ currentPassword: z.string(), newPassword: accountSchema.shape.password })),
    },
    responses: {
      204: { description: 'Changed' },
      ...unauthenticated,
      403: { description: 'The current password is wrong: wrong_password', content: errorContent },
    },
  });

  const signOutOthersRoute = createRoute({
    method: 'post',
    path: '/me/sign-out-others',
    tags: ['members'],
    summary: "End the signed-in member's sessions on every other device",
    middleware,
    responses: { 204: { description: 'Signed out' }, ...unauthenticated },
  });

  return new OpenAPIHono()
    .openapi(route, (c) => c.json(toMe(c.var.member), 200))
    .openapi(renameRoute, async (c) => {
      const { name } = c.req.valid('json');
      await auth.api.updateUser({ body: { name }, headers: c.req.raw.headers });
      return c.json(toMe({ ...c.var.member, name }), 200);
    })
    .openapi(passwordRoute, async (c) => {
      try {
        await auth.api.changePassword({ body: c.req.valid('json'), headers: c.req.raw.headers });
      } catch (error) {
        if (error instanceof APIError && error.body?.code === 'INVALID_PASSWORD') {
          return c.json({ error: 'wrong_password' }, 403);
        }
        throw error;
      }
      return c.body(null, 204);
    })
    .openapi(signOutOthersRoute, async (c) => {
      await auth.api.revokeOtherSessions({ headers: c.req.raw.headers });
      return c.body(null, 204);
    });
}
