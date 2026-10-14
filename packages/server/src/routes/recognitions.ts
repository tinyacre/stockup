import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { evidenceContentTypes, recognitionErrors, recognitionStatuses } from '../db/schema';
import { EvidenceTooLargeError, maxEvidenceSize, UnsupportedEvidenceTypeError } from '../evidence';
import type { EvidenceStore } from '../evidence-store';
import { requireMember } from '../members';
import { findRecognition, readScreenshot, startRecognition } from '../recognitions';
import type { ScreenshotRecognizer } from '../recognizer';
import { pricingUnitSchema } from './catalog';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const idParams = z.object({ id: z.string() });

const discountSchema = z.object({
  amount: z.number().int().openapi({ description: 'Cents' }),
  name: z.string().optional(),
});

const draftSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sizeText: z.string().nullable().openapi({ description: 'The size as the screenshot writes it' }),
    size: z
      .object({ amount: z.number(), unit: pricingUnitSchema })
      .nullable()
      .openapi({ description: 'The size text read as an amount and unit; null when it could not be' }),
    quantity: z.number().int().nullable(),
    listPrice: z.number().int().nullable().openapi({ description: 'Cents' }),
    discounts: z.array(discountSchema).openapi({ description: "The line's own discounts" }),
    suggestedProduct: z
      .object({ id: z.string(), name: z.string(), pricingUnit: pricingUnitSchema, baseSize: z.number() })
      .nullable()
      .openapi({ description: "The household's product whose name matches best, if any" }),
  })
  .openapi('RecognitionDraft');

const recognitionSchema = z
  .object({
    id: z.string(),
    status: z.enum(recognitionStatuses),
    error: z.enum(recognitionErrors).nullable().openapi({
      description:
        'Why it failed: no recognizer is configured (recognition_unavailable), the recognizer failed or gave an answer it could not read (recognition_failed), or the server restarted while it ran (recognition_interrupted)',
    }),
    requestedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    screenshot: z
      .object({ contentType: z.enum(evidenceContentTypes), size: z.number().int().openapi({ description: 'Bytes' }) })
      .openapi({ description: 'Read through GET /recognitions/{id}/screenshot' }),
    date: z.string().nullable().openapi({ description: 'The date the screenshot shows, as YYYY-MM-DD' }),
    channel: z.string().nullable().openapi({ description: 'The channel the screenshot names' }),
    orderDiscounts: z.array(discountSchema).openapi({ description: 'Discounts on the whole order' }),
    drafts: z
      .array(draftSchema)
      .openapi({ description: 'In the order the screenshot lists them; empty until it succeeds' }),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .openapi('Recognition');

type Found = NonNullable<Awaited<ReturnType<typeof findRecognition>>>;

function serialize(r: Found) {
  return { ...r, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null };
}

export function recognitionRoutes(
  db: Database,
  auth: Auth,
  store: EvidenceStore,
  recognizer: ScreenshotRecognizer | undefined,
) {
  const middleware = requireMember(auth, db);
  const unauthenticated = { 401: { description: 'Not signed in' } };
  const notFound = { 404: { description: 'No such recognition in this household', content: errorContent } };
  const recognitionContent = { 'application/json': { schema: recognitionSchema } };

  const startRoute = createRoute({
    method: 'post',
    path: '/recognitions',
    tags: ['recognitions'],
    summary: 'Upload a screenshot to be recognized into drafts',
    description:
      'Recognition runs in the background: poll GET /recognitions/{id} until the status leaves pending. Without a configured recognizer it fails at once with recognition_unavailable; the screenshot is kept either way.',
    middleware,
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.instanceof(File).openapi({
                type: 'string',
                format: 'binary',
                description: 'A PNG, JPEG, WebP or GIF image of at most 10 MB',
              }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      201: { description: 'Started', content: recognitionContent },
      ...unauthenticated,
      413: { description: 'The file is over 10 MB (evidence_too_large)', content: errorContent },
      422: { description: 'The file is not a supported image (unsupported_evidence_type)', content: errorContent },
    },
  });

  const getRoute = createRoute({
    method: 'get',
    path: '/recognitions/{id}',
    tags: ['recognitions'],
    summary: 'Get a recognition and its drafts',
    middleware,
    request: { params: idParams },
    responses: {
      200: { description: 'The recognition', content: recognitionContent },
      ...unauthenticated,
      ...notFound,
    },
  });

  const screenshotRoute = createRoute({
    method: 'get',
    path: '/recognitions/{id}/screenshot',
    tags: ['recognitions'],
    summary: "Read a recognition's screenshot",
    middleware,
    request: { params: idParams },
    responses: {
      200: {
        description: 'The image',
        content: { 'image/*': { schema: z.string().openapi({ type: 'string', format: 'binary' }) } },
      },
      ...unauthenticated,
      ...notFound,
    },
  });

  const availabilityRoute = createRoute({
    method: 'get',
    path: '/recognizer',
    tags: ['recognitions'],
    summary: 'Report whether screenshots can be recognized',
    description: 'Recognition is unavailable until the server is configured with a recognizer.',
    middleware,
    responses: {
      200: {
        description: 'Whether recognition is available',
        content: { 'application/json': { schema: z.object({ available: z.boolean() }) } },
      },
      ...unauthenticated,
    },
  });

  const app = new OpenAPIHono();
  app.use(
    '/recognitions',
    // Bounds what is read into memory before the file's size is checked.
    bodyLimit({
      maxSize: maxEvidenceSize + 1024 * 1024,
      onError: (c) => c.json({ error: 'evidence_too_large' }, 413),
    }),
  );
  return app
    .openapi(availabilityRoute, (c) => c.json({ available: recognizer !== undefined }, 200))
    .openapi(startRoute, async (c) => {
      const { file } = c.req.valid('form');
      if (file.size > maxEvidenceSize) return c.json({ error: 'evidence_too_large' }, 413);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const started = await startRecognition(db, store, recognizer, c.var.member, bytes);
        return c.json(serialize(started), 201);
      } catch (error) {
        if (error instanceof EvidenceTooLargeError) return c.json({ error: 'evidence_too_large' }, 413);
        if (error instanceof UnsupportedEvidenceTypeError) return c.json({ error: 'unsupported_evidence_type' }, 422);
        throw error;
      }
    })
    .openapi(getRoute, async (c) => {
      const found = await findRecognition(db, c.var.member, c.req.valid('param').id);
      return found ? c.json(serialize(found), 200) : c.json({ error: 'not_found' }, 404);
    })
    .openapi(screenshotRoute, async (c) => {
      const found = await readScreenshot(db, store, c.var.member, c.req.valid('param').id);
      if (!found) return c.json({ error: 'not_found' }, 404);
      return c.body(found.bytes, 200, {
        'content-type': found.contentType,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=31536000, immutable',
      });
    });
}
