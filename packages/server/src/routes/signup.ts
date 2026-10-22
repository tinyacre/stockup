import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { NameTakenError } from '../db/errors';
import { EmailCodeInvalidError, EmailCodeThrottledError, normalizeEmail, type EmailCodes } from '../email-codes';
import { emailInUse, EmailTakenError } from '../households';
import { describeInvitation } from '../invitations';
import { signUp } from '../signup';
import { respondToInvitationError } from './invitation-errors';
import { accountSchema } from './setup';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

export const emailSchema = z.email().transform(normalizeEmail);
export const emailCodeSchema = z.string().regex(/^\d{6}$/);

const codeErrors = {
  invalid: 'code_invalid',
  expired: 'code_expired',
  attempts_exceeded: 'code_attempts_exceeded',
} as const;

// For the endpoints that redeem a code; rethrows anything that is not a rejected code.
export function respondToInvalidCode(c: Context, error: unknown) {
  if (error instanceof EmailCodeInvalidError) return c.json({ error: codeErrors[error.reason] }, 422);
  throw error;
}

export const codeFailures = {
  422: {
    description: 'The code is wrong or superseded (code_invalid), expired (code_expired), or out of attempts (code_attempts_exceeded)',
    content: errorContent,
  },
};

const sendCodeRoute = createRoute({
  method: 'post',
  path: '/email-codes',
  tags: ['accounts'],
  summary: 'Mail a verification code to an address',
  description:
    'Answers 204 whether or not a code was mailed, so the answer does not tell whether the address is registered. ' +
    'Each address may be sent one code a minute and five an hour per purpose; a new code replaces the previous one.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            email: emailSchema,
            purpose: z.enum(['register', 'join']),
            invitationId: z.string().optional().openapi({ description: 'Required for join' }),
          }),
        },
      },
    },
  },
  responses: {
    204: { description: 'Accepted' },
    403: {
      description: 'The instance cannot mail (email_unavailable) or signup is closed (signup_closed)',
      content: errorContent,
    },
    404: { description: 'join: no such invitation (not_found)', content: errorContent },
    410: {
      description: 'join: the invitation was used, revoked or has expired (invitation_used, invitation_revoked, invitation_expired)',
      content: errorContent,
    },
    429: {
      description: 'Sent too recently: code_rate_limited, with retryAfter seconds (also in Retry-After)',
      content: { 'application/json': { schema: z.object({ error: z.string(), retryAfter: z.number().int() }) } },
    },
  },
});

const signUpRoute = createRoute({
  method: 'post',
  path: '/signup',
  tags: ['accounts'],
  summary: 'Register with an emailed code, creating a household the new member administers',
  description: 'The household is named after the username. Signs the new member in.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: accountSchema.extend({ email: emailSchema, code: emailCodeSchema }) } },
    },
  },
  responses: {
    201: {
      description: 'The member and their household were created',
      content: { 'application/json': { schema: z.object({ userId: z.string(), householdId: z.string() }) } },
    },
    403: { description: 'Signup is closed: signup_closed', content: errorContent },
    409: { description: 'The username (username_taken) or email (email_taken) is in use', content: errorContent },
    ...codeFailures,
  },
});

export function signupRoutes(db: Database, auth: Auth, { codes, signupOpen }: { codes?: EmailCodes; signupOpen: boolean }) {
  return new OpenAPIHono()
    .openapi(sendCodeRoute, async (c) => {
      const { email, purpose, invitationId } = c.req.valid('json');
      if (!codes) return c.json({ error: 'email_unavailable' }, 403);
      let deliver: boolean;
      switch (purpose) {
        case 'register':
          if (!signupOpen) return c.json({ error: 'signup_closed' }, 403);
          // A registered address is rate-limited all the same but mailed nothing, so it looks like any other.
          deliver = !(await emailInUse(db, email));
          break;
        case 'join':
          // Only the holder of a usable link gets this far, and a taken address is refused once its code verifies.
          if (invitationId === undefined) return c.json({ error: 'not_found' }, 404);
          try {
            await describeInvitation(db, invitationId);
          } catch (error) {
            return respondToInvitationError(c, error);
          }
          deliver = true;
          break;
      }
      try {
        await codes.send(email, purpose, { deliver });
      } catch (error) {
        if (!(error instanceof EmailCodeThrottledError)) throw error;
        c.header('Retry-After', String(error.retryAfterSeconds));
        return c.json({ error: 'code_rate_limited', retryAfter: error.retryAfterSeconds }, 429);
      }
      return c.body(null, 204);
    })
    .openapi(signUpRoute, async (c) => {
      if (!codes || !signupOpen) return c.json({ error: 'signup_closed' }, 403);
      const input = c.req.valid('json');
      let created;
      try {
        created = await signUp(auth, codes, input);
      } catch (error) {
        if (error instanceof NameTakenError) return c.json({ error: 'username_taken' }, 409);
        if (error instanceof EmailTakenError) return c.json({ error: 'email_taken' }, 409);
        return respondToInvalidCode(c, error);
      }

      const { headers } = await auth.api.signInUsername({
        body: { username: input.username, password: input.password },
        returnHeaders: true,
      });
      for (const cookie of headers.getSetCookie()) c.header('set-cookie', cookie, { append: true });
      return c.json(created, 201);
    });
}
