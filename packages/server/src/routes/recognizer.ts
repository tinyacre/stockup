import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { recognitionSources } from '../db/schema';
import { CredentialRejectedError, type CredentialSummary, type HouseholdCredentials } from '../household-credentials';
import { requireMember } from '../members';
import type { RecognitionAccess } from '../recognition-access';
import { recognitionProviders, recognizerProblems } from '../recognizer';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

const credentialSchema = z
  .object({
    provider: z.enum(recognitionProviders),
    baseURL: z.string().nullable().openapi({ description: "Null for the provider's own endpoint" }),
    model: z.string().nullable().openapi({ description: "Null for the provider's default model" }),
    apiKeyLastFour: z.string().openapi({ description: 'The last four characters of the key; the rest is never shown' }),
    updatedAt: z.iso.datetime(),
    updatedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  })
  .openapi('RecognitionCredential');

function serializeCredential(credential: CredentialSummary) {
  return { ...credential, updatedAt: credential.updatedAt.toISOString() };
}

const recognitionStatusSchema = z
  .object({
    available: z.boolean().openapi({ description: 'Whether a screenshot uploaded now would be recognized' }),
    source: z.enum(recognitionSources).nullable().openapi({
      description:
        "What recognitions are read with: the household's own credential, without a quota (household), or the instance's provider within its monthly quota (instance); null when the household has nothing to recognize with",
    }),
    quota: z
      .object({
        monthly: z.number().int().openapi({ description: 'Recognitions each household gets a month' }),
        used: z.number().int().openapi({
          description:
            'Recognitions this month that produced drafts or are still running; failed ones and ones that found nothing do not count',
        }),
        resetsOn: z.string().openapi({ description: 'The first day of next month, as YYYY-MM-DD' }),
      })
      .nullable()
      .openapi({ description: 'Null for a source without a quota' }),
    householdAdmin: z.boolean().openapi({ description: 'Whether the caller is the household admin' }),
    householdCredentials: z.boolean().openapi({
      description: 'Whether the instance lets household admins configure a credential of their own',
    }),
    credential: credentialSchema.nullable().openapi({
      description: "The household's own credential, shown to the household admin only; null for everyone else",
    }),
  })
  .openapi('RecognitionStatus');

const emptyAsNull = (value: string | null | undefined) => value || null;

const credentialInputSchema = z.object({
  provider: z.enum(recognitionProviders),
  // Long enough that the last four characters shown give little of it away.
  apiKey: z.string().trim().min(8).max(500),
  baseURL: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullish()
    .or(z.literal(''))
    .transform(emptyAsNull)
    .openapi({
      description:
        "An OpenAI-compatible service such as https://openrouter.ai/api/v1, at a public https address; empty for the provider's own",
    }),
  model: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform(emptyAsNull)
    .openapi({ description: "Empty for the provider's default model" }),
});

const rejectedContent = {
  'application/json': {
    schema: z.object({
      error: z.literal('credential_rejected'),
      problem: z.enum(recognizerProblems).openapi({
        description:
          'The provider refused the key (authentication_failed) or has no such model (model_not_found), could not be reached (unreachable), the base URL is not at a public address (endpoint_not_public), or the provider reported another error, such as a model that cannot read images (provider_error)',
      }),
    }),
  },
};

// What the household recognizes screenshots with, and the household admin's own credential.
export function recognizerRoutes(
  db: Database,
  auth: Auth,
  access: RecognitionAccess,
  credentials: HouseholdCredentials | undefined,
) {
  const adminOnly = requireMember(auth, db, { householdAdmin: true });
  const common = {
    401: { description: 'Not signed in' },
    403: {
      description:
        'Only the household admin manages the credential (forbidden), and only on an instance with an encryption key (household_credentials_unavailable)',
      content: errorContent,
    },
  };

  const statusRoute = createRoute({
    method: 'get',
    path: '/recognizer',
    tags: ['recognitions'],
    summary: "Report whether and with what the household's screenshots can be recognized",
    description:
      "A household with a credential of its own recognizes with it, without a quota. Otherwise the instance's provider gives every household the same number of recognitions a month, counted from the first day of the month in the server's time zone; only recognitions that produce drafts or are still running count.",
    middleware: requireMember(auth, db),
    responses: {
      200: {
        description: 'The recognition status',
        content: { 'application/json': { schema: recognitionStatusSchema } },
      },
      401: { description: 'Not signed in' },
    },
  });

  const saveRoute = createRoute({
    method: 'put',
    path: '/household/recognition-credential',
    tags: ['recognitions'],
    summary: "Set or replace the provider and API key the household's screenshots are recognized with",
    description:
      'The configuration is tried against the provider with a small image first and refused if it fails. Recognitions then use it instead of the instance quota, and fail with household_key_unavailable when it stops working rather than falling back to the instance.',
    middleware: adminOnly,
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
    middleware: adminOnly,
    responses: { 204: { description: 'Removed, or there was none' }, ...common },
  });

  const unavailable = { error: 'household_credentials_unavailable' } as const;
  return new OpenAPIHono()
    .openapi(statusRoute, async (c) => {
      const { credential, ...status } = await access.status(db, c.var.member);
      return c.json({ ...status, credential: credential && serializeCredential(credential) }, 200);
    })
    .openapi(saveRoute, async (c) => {
      if (!credentials) return c.json(unavailable, 403);
      try {
        return c.json(serializeCredential(await credentials.save(c.var.member, c.req.valid('json'))), 200);
      } catch (error) {
        if (error instanceof CredentialRejectedError) {
          return c.json({ error: 'credential_rejected' as const, problem: error.problem }, 422);
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
