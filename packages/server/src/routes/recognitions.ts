import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { ParentNotFoundError } from '../db/errors';
import { evidenceContentTypes, recognitionErrors, recognitionStatuses } from '../db/schema';
import { EvidenceTooLargeError, maxEvidenceSize, UnsupportedEvidenceTypeError } from '../evidence';
import type { EvidenceStore } from '../evidence-store';
import { requireMember } from '../members';
import { ProductNotFoundError, PromotionNotFoundError } from '../price-records';
import {
  confirmRecognition,
  deleteDraft,
  DraftRejectedError,
  editDraft,
  findRecognition,
  NoDraftsError,
  readScreenshot,
  RecognitionConfirmedError,
  startRecognition,
} from '../recognitions';
import { HOUSEHOLD_ADMIN_ROLE } from '../households';
import type { RecognitionAccess } from '../recognition-access';
import { pricingUnitSchema } from './catalog';
import {
  cents,
  discountSchema as discountInputSchema,
  priceRecordInputSchema,
  priceRecordSchema,
  sizeSchema,
} from './price-records';
import { hasChanges, nothingToChange } from './changes';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const idParams = z.object({ id: z.string() });
const draftParams = z.object({ id: z.string(), draftId: z.string() });

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
    orderDiscount: z.number().int().nullable().openapi({
      description:
        "Cents: the draft's share of the order discounts, shared out by list price; null while a draft's list price is unknown or the discounts would leave a draft free",
    }),
    suggestedProduct: z
      .object({ id: z.string(), name: z.string(), pricingUnit: pricingUnitSchema, baseSize: z.number() })
      .nullable()
      .openapi({
        description: "The household's product whose name matches best, or the one a member chose; null for none",
      }),
  })
  .openapi('RecognitionDraft');

const recognitionSchema = z
  .object({
    id: z.string(),
    status: z.enum(recognitionStatuses),
    error: z.enum(recognitionErrors).nullable().openapi({
      description:
        "Why it failed: the household has nothing to recognize with (recognition_unavailable), it has used up this month's recognitions on the instance's provider (recognition_quota_exhausted), the recognizer failed or gave an answer it could not read (recognition_failed), or the server restarted while it ran (recognition_interrupted)",
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
    confirmedAt: z.iso.datetime().nullable().openapi({
      description: 'When its drafts were written as price records; drafts is empty from then on',
    }),
  })
  .openapi('Recognition');

const recognitionStatusSchema = z
  .object({
    available: z.boolean().openapi({ description: 'Whether a screenshot uploaded now would be recognized' }),
    source: z.enum(['instance']).nullable().openapi({
      description:
        "What recognitions are read with: the instance's provider within its monthly quota (instance); null when the household has nothing to recognize with",
    }),
    quota: z
      .object({
        monthly: z.number().int().openapi({ description: 'Recognitions each household gets a month' }),
        used: z.number().int().openapi({
          description: 'Recognitions this month that succeeded or are still running; failed ones do not count',
        }),
        resetsOn: z.string().openapi({ description: 'The first day of next month, as YYYY-MM-DD' }),
      })
      .nullable()
      .openapi({ description: 'Null for a source without a quota' }),
    householdAdmin: z.boolean().openapi({ description: 'Whether the caller is the household admin' }),
  })
  .openapi('RecognitionStatus');

const draftChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    size: sizeSchema.nullable().optional(),
    quantity: z.number().int().positive().max(1_000_000).nullable().optional(),
    listPrice: cents.nullable().optional().openapi({
      description: 'Cents; a new list price shares the order discounts out again over every draft',
    }),
    discounts: z.array(discountInputSchema).max(20).optional(),
    orderDiscount: z
      .number()
      .int()
      .min(0)
      .max(2_000_000_000)
      .optional()
      .openapi({ description: "Cents: adjusts this draft's share of the order discounts" }),
    productId: z.string().nullable().optional(),
  })
  .refine(hasChanges, nothingToChange);

const confirmationSchema = priceRecordInputSchema.pick({
  date: true,
  channelId: true,
  purchased: true,
  promotionId: true,
});

type Found = NonNullable<Awaited<ReturnType<typeof findRecognition>>>;

function serialize(r: Found) {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  };
}

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

export function recognitionRoutes(db: Database, auth: Auth, store: EvidenceStore, access: RecognitionAccess) {
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
      "Recognition runs in the background: poll GET /recognitions/{id} until the status leaves pending. When the household has nothing to recognize with it fails at once with recognition_unavailable, and when it has used up this month's quota with recognition_quota_exhausted; the screenshot is kept either way.",
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

  const draftNotFound = {
    404: { description: 'No such recognition in this household, or no such draft in it', content: errorContent },
  };
  const confirmed = {
    409: { description: 'The recognition is already confirmed (already_confirmed)', content: errorContent },
  };

  const editDraftRoute = createRoute({
    method: 'patch',
    path: '/recognitions/{id}/drafts/{draftId}',
    tags: ['recognitions'],
    summary: 'Change a draft before it is confirmed',
    middleware,
    request: { params: draftParams, body: json(draftChangesSchema) },
    responses: {
      200: { description: 'The recognition with the changed draft', content: recognitionContent },
      ...unauthenticated,
      ...draftNotFound,
      ...confirmed,
      422: { description: 'The product is not in this household (product_not_found)', content: errorContent },
    },
  });

  const deleteDraftRoute = createRoute({
    method: 'delete',
    path: '/recognitions/{id}/drafts/{draftId}',
    tags: ['recognitions'],
    summary: 'Drop a draft, sharing the order discounts out again over the rest',
    middleware,
    request: { params: draftParams },
    responses: {
      200: { description: 'The recognition without the draft', content: recognitionContent },
      ...unauthenticated,
      ...draftNotFound,
      ...confirmed,
    },
  });

  const confirmRoute = createRoute({
    method: 'post',
    path: '/recognitions/{id}/confirm',
    tags: ['recognitions'],
    summary: 'Write every draft as a price record',
    description:
      'Each draft becomes a price record with source recognition: its own discounts plus its share of the order discounts, and a copy of the screenshot as evidence. The drafts are then removed. Either every draft is written or none is.',
    middleware,
    request: { params: idParams, body: json(confirmationSchema) },
    responses: {
      201: {
        description: 'The price records, in the order of the drafts',
        content: { 'application/json': { schema: z.object({ priceRecords: z.array(priceRecordSchema) }) } },
      },
      ...unauthenticated,
      ...notFound,
      ...confirmed,
      422: {
        description:
          'There are no drafts (no_drafts); the channel or promotion is not in this household (channel_not_found, promotion_not_found); or the draft named by draftId lacks a product, size, quantity, list price or order discount share (draft_incomplete), has a size the product cannot convert (incompatible_unit), or discounts that leave nothing to pay (invalid_price)',
        content: {
          'application/json': { schema: z.object({ error: z.string(), draftId: z.string().optional() }) },
        },
      },
    },
  });

  const availabilityRoute = createRoute({
    method: 'get',
    path: '/recognizer',
    tags: ['recognitions'],
    summary: "Report whether and with what the household's screenshots can be recognized",
    description:
      "The instance's provider gives every household the same number of recognitions a month, counted from the first day of the month in the server's time zone. Only recognitions that succeed or are still running count.",
    middleware,
    responses: {
      200: {
        description: 'The recognition status',
        content: { 'application/json': { schema: recognitionStatusSchema } },
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
    .openapi(availabilityRoute, async (c) => {
      const status = await access.status(db, c.var.member);
      return c.json({ ...status, householdAdmin: c.var.member.householdRole === HOUSEHOLD_ADMIN_ROLE }, 200);
    })
    .openapi(startRoute, async (c) => {
      const { file } = c.req.valid('form');
      if (file.size > maxEvidenceSize) return c.json({ error: 'evidence_too_large' }, 413);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const started = await startRecognition(db, store, access, c.var.member, bytes);
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
    .openapi(editDraftRoute, async (c) => {
      const { id, draftId } = c.req.valid('param');
      try {
        if (!(await editDraft(db, c.var.member, id, draftId, c.req.valid('json')))) {
          return c.json({ error: 'not_found' }, 404);
        }
      } catch (error) {
        if (error instanceof RecognitionConfirmedError) return c.json({ error: 'already_confirmed' }, 409);
        if (error instanceof ProductNotFoundError) return c.json({ error: 'product_not_found' }, 422);
        throw error;
      }
      return c.json(serialize((await findRecognition(db, c.var.member, id))!), 200);
    })
    .openapi(deleteDraftRoute, async (c) => {
      const { id, draftId } = c.req.valid('param');
      try {
        if (!(await deleteDraft(db, c.var.member, id, draftId))) return c.json({ error: 'not_found' }, 404);
      } catch (error) {
        if (error instanceof RecognitionConfirmedError) return c.json({ error: 'already_confirmed' }, 409);
        throw error;
      }
      return c.json(serialize((await findRecognition(db, c.var.member, id))!), 200);
    })
    .openapi(confirmRoute, async (c) => {
      try {
        const priceRecords = await confirmRecognition(
          db,
          store,
          c.var.member,
          c.req.valid('param').id,
          c.req.valid('json'),
        );
        return priceRecords ? c.json({ priceRecords }, 201) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        if (error instanceof RecognitionConfirmedError) return c.json({ error: 'already_confirmed' }, 409);
        if (error instanceof NoDraftsError) return c.json({ error: 'no_drafts' }, 422);
        if (error instanceof DraftRejectedError) return c.json({ error: error.reason, draftId: error.draftId }, 422);
        if (error instanceof ParentNotFoundError) return c.json({ error: 'channel_not_found' }, 422);
        if (error instanceof PromotionNotFoundError) return c.json({ error: 'promotion_not_found' }, 422);
        throw error;
      }
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
