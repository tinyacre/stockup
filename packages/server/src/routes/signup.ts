import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import { EmailTakenError, NameTakenError } from '../db/errors';
import type { EmailCodes } from '../email-codes';
import { signUp } from '../signup';
import { codeFailures, emailCodeSchema, emailSchema, respondToInvalidCode, turnstileFailure } from './email-codes';
import { accountSchema } from './setup';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

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
    ...turnstileFailure,
    403: { description: 'Signup is closed: signup_closed', content: errorContent },
    409: { description: 'The username (username_taken) or email (email_taken) is in use', content: errorContent },
    ...codeFailures,
  },
});

export function signupRoutes(auth: Auth, { codes, signupOpen }: { codes?: EmailCodes; signupOpen: boolean }) {
  return new OpenAPIHono()
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
