import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { EmailTakenError, NameTakenError } from '../db/errors';
import { EmailCodeInvalidError, type EmailCodes } from '../email-codes';
import {
  acceptInvitation,
  acceptInvitationWithEmail,
  AlreadyMemberError,
  createInvitation,
  describeInvitation,
  InvitationUnusableError,
  listInvitations,
  rejoinThroughInvitation,
  revokeInvitation,
} from '../invitations';
import { requireMember } from '../members';
import { respondToInvitationError as respondToError, unusableInvitationCode as unusableCode } from './invitation-errors';
import { accountSchema } from './setup';
import { codeFailures, emailCodeSchema, emailSchema, respondToInvalidCode, turnstileFailure } from './signup';

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

// With `codes` the instance can mail, and joining requires an email verified with a join code.
export function invitationRoutes(db: Database, auth: Auth, { codes }: { codes?: EmailCodes } = {}) {
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
    description:
      'Uses up the invitation and signs the new member in. On an instance that can mail, `email` and a `join` ' +
      'code mailed to it are required, and a missing one is code_invalid; otherwise both are ignored.',
    request: {
      params: idParams,
      body: json(accountSchema.extend({ email: emailSchema.optional(), code: emailCodeSchema.optional() })),
    },
    responses: {
      201: {
        description: 'The member was created',
        content: { 'application/json': { schema: z.object({ userId: z.string(), householdId: z.string() }) } },
      },
      ...turnstileFailure,
      ...notFound,
      409: { description: 'The username (username_taken) or email (email_taken) is in use', content: errorContent },
      ...unusable,
      ...codeFailures,
    },
  });

  const rejoinRoute = createRoute({
    method: 'post',
    path: '/join/{id}/rejoin',
    tags: ['invitations'],
    summary: "Join the invitation's household with the signed-in account",
    description:
      'For an account that belongs to no household, as after being removed from one. It keeps its username and price records.',
    request: { params: idParams },
    responses: {
      201: {
        description: 'The account joined the household',
        content: { 'application/json': { schema: z.object({ userId: z.string(), householdId: z.string() }) } },
      },
      401: { description: 'Not signed in' },
      ...notFound,
      409: { description: 'The account already belongs to a household: already_member', content: errorContent },
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
      const { email, code, ...account } = c.req.valid('json');
      const { id } = c.req.valid('param');
      let joined;
      try {
        if (!codes) joined = await acceptInvitation(db, auth, id, account);
        else if (email === undefined || code === undefined) return c.json({ error: 'code_invalid' }, 422);
        else joined = await acceptInvitationWithEmail(auth, codes, id, { ...account, email, code });
      } catch (error) {
        if (error instanceof NameTakenError) return c.json({ error: 'username_taken' }, 409);
        if (error instanceof EmailTakenError) return c.json({ error: 'email_taken' }, 409);
        if (error instanceof EmailCodeInvalidError) return respondToInvalidCode(c, error);
        return respondToError(c, error);
      }

      const { headers } = await auth.api.signInUsername({
        body: { username: account.username, password: account.password },
        returnHeaders: true,
      });
      for (const cookie of headers.getSetCookie()) c.header('set-cookie', cookie, { append: true });
      return c.json(joined, 201);
    })
    .openapi(rejoinRoute, async (c) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: 'unauthenticated' }, 401);
      try {
        return c.json(await rejoinThroughInvitation(db, c.req.valid('param').id, session.user.id), 201);
      } catch (error) {
        if (error instanceof AlreadyMemberError) return c.json({ error: 'already_member' }, 409);
        return respondToError(c, error);
      }
    });
}
