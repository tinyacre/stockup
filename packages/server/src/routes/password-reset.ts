import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { EmailCodes } from '../email-codes';
import { resetPassword } from '../password-reset';
import { accountSchema } from './setup';
import { codeFailures, emailCodeSchema, emailSchema, respondToInvalidCode } from './signup';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

const resetRoute = createRoute({
  method: 'post',
  path: '/password-reset',
  tags: ['accounts'],
  summary: "Set a new password with a code mailed to the account's address",
  description: 'Request the code from POST /email-codes with purpose password-reset. Signs the account out everywhere.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ email: emailSchema, code: emailCodeSchema, newPassword: accountSchema.shape.password }),
        },
      },
    },
  },
  responses: {
    204: { description: 'The password was changed and every session of the account ended' },
    403: { description: 'The instance cannot mail: email_unavailable', content: errorContent },
    ...codeFailures,
  },
});

export function passwordResetRoutes(auth: Auth, { codes }: { codes?: EmailCodes }) {
  return new OpenAPIHono().openapi(resetRoute, async (c) => {
    if (!codes) return c.json({ error: 'email_unavailable' }, 403);
    try {
      await resetPassword(auth, codes, c.req.valid('json'));
    } catch (error) {
      return respondToInvalidCode(c, error);
    }
    return c.body(null, 204);
  });
}
