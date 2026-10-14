import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import type { Database } from '../db';
import {
  listMembers,
  makeHouseholdAdmin,
  MemberNotFoundError,
  NotHouseholdAdminError,
  OwnMembershipError,
  removeMember,
  requireMember,
} from '../members';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const idParams = z.object({ id: z.string().openapi({ description: "The member's user ID" }) });

const memberSchema = z
  .object({
    id: z.string().openapi({ description: "The member's user ID, as in a price record's recordedBy" }),
    name: z.string(),
    username: z.string(),
    role: z.enum(['admin', 'member']),
    joinedAt: z.iso.datetime(),
  })
  .openapi('Member');

function respondToError(c: Context, error: unknown, ownCode: string) {
  if (error instanceof MemberNotFoundError) return c.json({ error: 'not_found' }, 404);
  if (error instanceof NotHouseholdAdminError) return c.json({ error: 'forbidden' }, 403);
  if (error instanceof OwnMembershipError) return c.json({ error: ownCode }, 409);
  throw error;
}

export function memberRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db, { householdAdmin: true });
  const adminOnly = {
    401: { description: 'Not signed in' },
    403: { description: 'Only the household admin manages members', content: errorContent },
  };
  const notFound = { 404: { description: 'No such member in the household', content: errorContent } };

  const listRoute = createRoute({
    method: 'get',
    path: '/members',
    tags: ['members'],
    summary: "List the household's members, admin first",
    middleware,
    responses: {
      200: { description: 'Members', content: { 'application/json': { schema: z.array(memberSchema) } } },
      ...adminOnly,
    },
  });

  const removeRoute = createRoute({
    method: 'delete',
    path: '/members/{id}',
    tags: ['members'],
    summary: 'Remove a member from the household',
    description: "Ends the member's sessions. Their account remains, so price records keep their name.",
    middleware,
    request: { params: idParams },
    responses: {
      204: { description: 'Removed' },
      ...adminOnly,
      ...notFound,
      409: { description: 'The admin cannot remove themselves: cannot_remove_self', content: errorContent },
    },
  });

  const makeAdminRoute = createRoute({
    method: 'post',
    path: '/members/{id}/make-admin',
    tags: ['members'],
    summary: 'Hand the household admin role to another member',
    description: 'The current admin becomes an ordinary member.',
    middleware,
    request: { params: idParams },
    responses: {
      204: { description: 'Handed over' },
      ...adminOnly,
      ...notFound,
      409: { description: 'The member is already the admin: already_admin', content: errorContent },
    },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => c.json(await listMembers(db, c.var.member), 200))
    .openapi(removeRoute, async (c) => {
      try {
        await removeMember(db, c.var.member, c.req.valid('param').id);
      } catch (error) {
        return respondToError(c, error, 'cannot_remove_self');
      }
      return c.body(null, 204);
    })
    .openapi(makeAdminRoute, async (c) => {
      try {
        await makeHouseholdAdmin(db, c.var.member, c.req.valid('param').id);
      } catch (error) {
        return respondToError(c, error, 'already_admin');
      }
      return c.body(null, 204);
    });
}
