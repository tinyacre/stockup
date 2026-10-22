import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { APIError } from 'better-auth/api';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { EmailTakenError } from '../db/errors';
import type { EmailCodes } from '../email-codes';
import { changeEmail, requireMember, updateTheme, type CurrentMember } from '../members';
import { accountSchema } from './setup';
import { codeFailures, emailCodeSchema, emailSchema, respondToInvalidCode } from './email-codes';

export const themes = ['tool', 'price-tag'] as const;
type Theme = (typeof themes)[number];

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

const meSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    email: z.string().nullable().openapi({ description: 'Null until the member has a verified address' }),
    theme: z.enum(themes),
    isInstanceAdmin: z.boolean(),
  }),
  household: z.object({ id: z.string(), name: z.string(), role: z.string() }),
});

function toMe(m: CurrentMember) {
  return {
    user: {
      id: m.userId,
      username: m.username,
      name: m.name,
      email: m.email,
      theme: m.theme as Theme,
      isInstanceAdmin: m.isInstanceAdmin,
    },
    household: { id: m.householdId, name: m.householdName, role: m.householdRole },
  };
}

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

export function meRoutes(db: Database, auth: Auth, codes?: EmailCodes) {
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

  const updateRoute = createRoute({
    method: 'patch',
    path: '/me',
    tags: ['members'],
    summary: "Change the signed-in member's display name or theme",
    description:
      'Price records show the new name of the member who entered them. The theme follows the account to every device.',
    middleware,
    request: {
      body: json(accountSchema.pick({ name: true }).partial().extend({ theme: z.enum(themes).optional() })),
    },
    responses: {
      200: { description: 'The updated member', content: { 'application/json': { schema: meSchema } } },
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

  const emailRoute = createRoute({
    method: 'post',
    path: '/me/email',
    tags: ['members'],
    summary: "Change or add the signed-in member's email",
    description:
      'Takes the code mailed to the new address (purpose change-email). The member then signs in and resets the password with it.',
    middleware,
    request: { body: json(z.object({ email: emailSchema, code: emailCodeSchema })) },
    responses: {
      200: { description: 'The updated member', content: { 'application/json': { schema: meSchema } } },
      ...unauthenticated,
      403: { description: 'The instance cannot mail: email_unavailable', content: errorContent },
      409: { description: 'Another account has the address: email_taken', content: errorContent },
      ...codeFailures,
    },
  });

  return new OpenAPIHono()
    .openapi(route, (c) => c.json(toMe(c.var.member), 200))
    .openapi(updateRoute, async (c) => {
      const { name, theme } = c.req.valid('json');
      if (name !== undefined) await auth.api.updateUser({ body: { name }, headers: c.req.raw.headers });
      if (theme !== undefined) await updateTheme(db, c.var.member.userId, theme);
      const { member } = c.var;
      return c.json(toMe({ ...member, name: name ?? member.name, theme: theme ?? member.theme }), 200);
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
    .openapi(emailRoute, async (c) => {
      if (!codes) return c.json({ error: 'email_unavailable' }, 403);
      const { email, code } = c.req.valid('json');
      try {
        await changeEmail(codes, c.var.member.userId, email, code);
      } catch (error) {
        if (error instanceof EmailTakenError) return c.json({ error: 'email_taken' }, 409);
        return respondToInvalidCode(c, error);
      }
      return c.json(toMe({ ...c.var.member, email }), 200);
    })
    .openapi(signOutOthersRoute, async (c) => {
      await auth.api.revokeOtherSessions({ headers: c.req.raw.headers });
      return c.body(null, 204);
    });
}
