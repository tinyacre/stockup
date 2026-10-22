import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { emailCodePurposes } from '../db/schema';
import { EmailCodeInvalidError, EmailCodeThrottledError, normalizeEmail, type EmailCodes } from '../email-codes';
import { emailInUse, isPlaceholderEmail } from '../households';
import { describeInvitation } from '../invitations';
import { passesTurnstile, type TurnstileVerifier } from '../turnstile';
import { respondToInvitationError } from './invitation-errors';

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

// For the endpoints createApp challenges; the instance's capabilities say whether a token is needed.
export const turnstileFailure = {
  400: { description: 'The x-turnstile-token header is missing or failed: turnstile_failed', content: errorContent },
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
            purpose: z.enum(emailCodePurposes),
            invitationId: z.string().optional().openapi({ description: 'Required for join' }),
          }),
        },
      },
    },
  },
  responses: {
    204: { description: 'Accepted' },
    401: { description: 'A change-email code was requested without signing in', content: errorContent },
    403: {
      description: 'The instance cannot mail (email_unavailable) or signup is closed (signup_closed)',
      content: errorContent,
    },
    404: { description: 'join: no such invitation (not_found)', content: errorContent },
    410: {
      description: 'join: the invitation was used, revoked or has expired (invitation_used, invitation_revoked, invitation_expired)',
      content: errorContent,
    },
    400: { description: 'The address is malformed, or the Turnstile token failed (turnstile_failed)', content: errorContent },
    429: {
      description: 'Sent too recently: code_rate_limited, with retryAfter seconds (also in Retry-After)',
      content: { 'application/json': { schema: z.object({ error: z.string(), retryAfter: z.number().int() }) } },
    },
  },
});

export function emailCodeRoutes(
  db: Database,
  auth: Auth,
  {
    codes,
    signupOpen,
    turnstile,
    clientIpHeader,
  }: { codes?: EmailCodes; signupOpen: boolean; turnstile?: TurnstileVerifier; clientIpHeader?: string },
) {
  return new OpenAPIHono()
    .openapi(sendCodeRoute, async (c) => {
      const { email, purpose, invitationId } = c.req.valid('json');
      if (!codes) return c.json({ error: 'email_unavailable' }, 403);
      // Checked before the purpose's own checks, so scripts cannot probe invitations or signup without solving it.
      if (!(await passesTurnstile(c, turnstile, clientIpHeader))) return c.json({ error: 'turnstile_failed' }, 400);
      let deliver: boolean;
      switch (purpose) {
        case 'register':
          if (!signupOpen) return c.json({ error: 'signup_closed' }, 403);
          // A registered address is rate-limited all the same but mailed nothing, so it looks like any other.
          deliver = !(await emailInUse(db, email));
          break;
        case 'change-email':
          if (!(await auth.api.getSession({ headers: c.req.raw.headers }))) {
            return c.json({ error: 'unauthenticated' }, 401);
          }
          // Whether another account has the address is reported only after its code is redeemed.
          deliver = true;
          break;
        case 'password-reset':
          // Unknown addresses are rate-limited and answered alike, so the answer does not reveal who is registered.
          deliver = !isPlaceholderEmail(email) && (await emailInUse(db, email));
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
    });
}
