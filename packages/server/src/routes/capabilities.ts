import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Mailer } from '../mailer';
import type { TurnstileVerifier } from '../turnstile';

const route = createRoute({
  method: 'get',
  path: '/capabilities',
  tags: ['system'],
  summary: 'Report which optional account features the instance offers',
  description: 'Needs no session: the sign-in page uses it to decide what to show.',
  responses: {
    200: {
      description: 'The optional features',
      content: {
        'application/json': {
          schema: z.object({
            signup: z.boolean().openapi({ description: 'Whether visitors may register with an email code' }),
            email: z.boolean().openapi({ description: 'Whether the instance can mail verification codes' }),
            turnstileSiteKey: z.string().nullable().openapi({ description: 'Set when requests need a Turnstile token' }),
          }),
        },
      },
    },
  },
});

export function capabilityRoutes({
  signupOpen,
  mailer,
  turnstile,
}: {
  signupOpen: boolean;
  mailer?: Mailer;
  turnstile?: TurnstileVerifier;
}) {
  return new OpenAPIHono().openapi(route, (c) =>
    c.json({ signup: signupOpen, email: mailer !== undefined, turnstileSiteKey: turnstile?.siteKey ?? null }, 200),
  );
}
