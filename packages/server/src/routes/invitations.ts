import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { NameTakenError } from '../db/errors';
import {
  acceptInvitation,
  createInvitation,
  describeInvitation,
  InvitationNotFoundError,
  InvitationUnusableError,
  listInvitations,
  revokeInvitation,
} from '../invitations';
import { requireMember } from '../members';
import { accountSchema } from './setup';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const idParams = z.object({ id: z.string() });

const invitationSchema = z
  .object({
    id: z.string().openapi({ description: 'Also the secret part of the invitation link' }),
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    invitedBy: z.object({ id: z.string(), name: z.string() }),
  })
  .openapi('Invitation');

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

const unusable = {
  410: {
    description:
      'The invitation was used (invitation_used), revoked (invitation_revoked) or has expired (invitation_expired)',
    content: errorContent,
  },
};

const unusableCode = { accepted: 'invitation_used', revoked: 'invitation_revoked', expired: 'invitation_expired' };

function respondToError(c: Context, error: unknown) {
  if (error instanceof InvitationNotFoundError) return c.json({ error: 'not_found' }, 404);
  if (error instanceof InvitationUnusableError) return c.json({ error: unusableCode[error.reason] }, 410);
  throw error;
}

export function invitationRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db, { householdAdmin: true });
  const adminOnly = {
    401: { description: 'Not signed in' },
    403: { description: 'Only household admins manage invitations', content: errorContent },
  };
  const notFound = { 404: { description: 'No such invitation', content: errorContent } };

  const listRoute = createRoute({
    method: 'get',
    path: '/invitations',
    tags: ['invitations'],
    summary: "List the household's invitations, newest first",
    middleware,
    responses: {
      200: { description: 'Invitations', content: { 'application/json': { schema: z.array(invitationSchema) } } },
      ...adminOnly,
    },
  });

  const createInvitationRoute = createRoute({
    method: 'post',
    path: '/invitations',
    tags: ['invitations'],
    summary: 'Create an invitation that admits one new member to the household',
    middleware,
    request: { body: json(z.object({ expiresInDays: z.number().int().min(1).max(30) })) },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: invitationSchema } } },
      ...adminOnly,
    },
  });

  const revokeRoute = createRoute({
    method: 'post',
    path: '/invitations/{id}/revoke',
    tags: ['invitations'],
    summary: 'Revoke an invitation so its link can no longer be used',
    middleware,
    request: { params: idParams },
    responses: {
      200: { description: 'Revoked', content: { 'application/json': { schema: invitationSchema } } },
      ...adminOnly,
      ...notFound,
      409: { description: 'The invitation was already used: invitation_used', content: errorContent },
    },
  });

  const describeRoute = createRoute({
    method: 'get',
    path: '/join/{id}',
    tags: ['invitations'],
    summary: 'Describe the household an invitation leads to',
    description: 'Needs no session: the invitation ID is the credential.',
    request: { params: idParams },
    responses: {
      200: {
        description: 'The invitation can be used',
        content: {
          'application/json': { schema: z.object({ householdName: z.string(), invitedBy: z.string() }) },
        },
      },
      ...notFound,
      ...unusable,
    },
  });

  const joinRoute = createRoute({
    method: 'post',
    path: '/join/{id}',
    tags: ['invitations'],
    summary: "Register a new member in the invitation's household",
    description: 'Uses up the invitation and signs the new member in.',
    request: { params: idParams, body: json(accountSchema) },
    responses: {
      201: {
        description: 'The member was created',
        content: { 'application/json': { schema: z.object({ userId: z.string(), householdId: z.string() }) } },
      },
      ...notFound,
      409: { description: 'The username is taken: username_taken', content: errorContent },
      ...unusable,
    },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => c.json(await listInvitations(db, c.var.member), 200))
    .openapi(createInvitationRoute, async (c) =>
      c.json(await createInvitation(db, c.var.member, c.req.valid('json')), 201),
    )
    .openapi(revokeRoute, async (c) => {
      try {
        return c.json(await revokeInvitation(db, c.var.member, c.req.valid('param').id), 200);
      } catch (error) {
        if (error instanceof InvitationUnusableError) return c.json({ error: unusableCode[error.reason] }, 409);
        return respondToError(c, error);
      }
    })
    .openapi(describeRoute, async (c) => {
      try {
        return c.json(await describeInvitation(db, c.req.valid('param').id), 200);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(joinRoute, async (c) => {
      const account = c.req.valid('json');
      let joined;
      try {
        joined = await acceptInvitation(db, auth, c.req.valid('param').id, account);
      } catch (error) {
        if (error instanceof NameTakenError) return c.json({ error: 'username_taken' }, 409);
        return respondToError(c, error);
      }

      const { headers } = await auth.api.signInUsername({
        body: { username: account.username, password: account.password },
        returnHeaders: true,
      });
      for (const cookie of headers.getSetCookie()) c.header('set-cookie', cookie, { append: true });
      return c.json(joined, 201);
    });
}
