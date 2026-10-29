import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { CredentialRejectedError, type CredentialSummary, type HouseholdCredentials } from '../household-credentials';
import { requireMember } from '../members';
import { recognitionProviders } from '../recognizer';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

export const credentialSchema = z
  .object({
    provider: z.enum(recognitionProviders),
    baseURL: z.string().nullable().openapi({ description: "Null for the provider's own endpoint" }),
    model: z.string().nullable().openapi({ description: "Null for the provider's default model" }),
    apiKeyLastFour: z.string().openapi({ description: 'The last four characters of the key; the rest is never shown' }),
    updatedAt: z.iso.datetime(),
    updatedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  })
  .openapi('RecognitionCredential');

export function serializeCredential(credential: CredentialSummary) {
  return { ...credential, updatedAt: credential.updatedAt.toISOString() };
}

const blank = (value: string | null | undefined) => value || null;

const credentialInputSchema = z.object({
  provider: z.enum(recognitionProviders),
  // Long enough that the last four characters shown give little of it away.
  apiKey: z.string().trim().min(8).max(500),
  baseURL: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullish()
    .or(z.literal(''))
    .transform(blank)
    .openapi({
      description: "An OpenAI-compatible service such as https://openrouter.ai/api/v1; empty for the provider's own",
    }),
  model: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform(blank)
    .openapi({ description: "Empty for the provider's default model" }),
});

const rejectedContent = {
  'application/json': {
    schema: z.object({
      error: z.literal('credential_rejected'),
      problem: z.enum(['authentication_failed', 'model_not_found', 'unreachable', 'provider_error']),
      message: z.string().openapi({ description: 'What the provider said' }),
    }),
  },
};

export function recognitionCredentialRoutes(db: Database, auth: Auth, credentials: HouseholdCredentials | undefined) {
  const middleware = requireMember(auth, db, { householdAdmin: true });
  const common = {
    401: { description: 'Not signed in' },
    403: {
      description:
        'Only the household admin manages the credential (forbidden), and only on an instance with an encryption key (household_credentials_unavailable)',
      content: errorContent,
    },
  };

  const saveRoute = createRoute({
    method: 'put',
    path: '/household/recognition-credential',
    tags: ['recognitions'],
    summary: "Set or replace the provider and API key the household's screenshots are recognized with",
    description:
      'The configuration is tried against the provider first and refused if it fails. Recognitions then use it instead of the instance quota, and fail with household_key_unavailable when it stops working rather than falling back to the instance.',
    middleware,
    request: { body: { required: true, content: { 'application/json': { schema: credentialInputSchema } } } },
    responses: {
      200: { description: 'The saved credential', content: { 'application/json': { schema: credentialSchema } } },
      ...common,
      422: { description: 'The provider refused the configuration', content: rejectedContent },
    },
  });

  const deleteRoute = createRoute({
    method: 'delete',
    path: '/household/recognition-credential',
    tags: ['recognitions'],
    summary: "Remove the household's own credential, going back to the instance quota",
    middleware,
    responses: { 204: { description: 'Removed, or there was none' }, ...common },
  });

  const unavailable = { error: 'household_credentials_unavailable' } as const;
  return new OpenAPIHono()
    .openapi(saveRoute, async (c) => {
      if (!credentials) return c.json(unavailable, 403);
      try {
        return c.json(serializeCredential(await credentials.save(c.var.member, c.req.valid('json'))), 200);
      } catch (error) {
        if (error instanceof CredentialRejectedError) {
          return c.json({ error: 'credential_rejected' as const, problem: error.problem, message: error.message }, 422);
        }
        throw error;
      }
    })
    .openapi(deleteRoute, async (c) => {
      if (!credentials) return c.json(unavailable, 403);
      await credentials.remove(c.var.member);
      return c.body(null, 204);
    });
}
