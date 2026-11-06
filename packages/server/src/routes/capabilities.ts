import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { WebTelemetryConfig } from '../config';
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
            turnstileSiteKey: z
              .string()
              .nullable()
              .openapi({ description: 'Set when requests need a Turnstile token' }),
            telemetry: z
              .object({
                release: z.string(),
                umami: z.object({ endpoint: z.string(), websiteId: z.string(), hostname: z.string() }),
                sentry: z.object({ dsn: z.string(), tunnel: z.string() }),
              })
              .nullable()
              .openapi({
                description:
                  'The @tinyacre/telemetry configuration for front-end analytics and errors; null when the instance collects none',
              }),
          }),
        },
      },
    },
  },
});

// The browser posts to paths on the instance's own origin, which the reverse proxy forwards: /_s/ to Umami and
// /_e/ to GlitchTip, each with the prefix stripped. GlitchTip's envelope endpoint is named by the DSN's project id
// and public key.
function telemetryFor(webTelemetry: WebTelemetryConfig, release: string, baseURL: string) {
  const dsn = new URL(webTelemetry.glitchtipDsn);
  const project = dsn.pathname.split('/').pop();
  return {
    release,
    umami: { endpoint: '/_s/api/send', websiteId: webTelemetry.umamiWebsiteId, hostname: new URL(baseURL).hostname },
    sentry: {
      dsn: webTelemetry.glitchtipDsn,
      tunnel: `/_e/api/${project}/envelope/?sentry_key=${encodeURIComponent(dsn.username)}`,
    },
  };
}

export function capabilityRoutes({
  signupOpen,
  mailer,
  turnstile,
  webTelemetry,
  release,
  baseURL,
}: {
  signupOpen: boolean;
  mailer?: Mailer;
  turnstile?: TurnstileVerifier;
  webTelemetry?: WebTelemetryConfig;
  release: string;
  // Every event reports this host as the app's, whichever host served the page.
  baseURL: string;
}) {
  const telemetry = webTelemetry ? telemetryFor(webTelemetry, release, baseURL) : null;
  return new OpenAPIHono().openapi(route, (c) =>
    c.json(
      { signup: signupOpen, email: mailer !== undefined, turnstileSiteKey: turnstile?.siteKey ?? null, telemetry },
      200,
    ),
  );
}
