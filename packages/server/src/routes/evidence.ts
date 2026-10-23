import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import { bodyLimit } from 'hono/body-limit';
import type { Database } from '../db';
import { evidenceContentTypes } from '../db/schema';
import {
  addEvidence,
  deleteEvidence,
  EvidenceTooLargeError,
  maxEvidenceSize,
  readEvidence,
  UnsupportedEvidenceTypeError,
} from '../evidence';
import type { EvidenceStore } from '../evidence-store';
import { requireMember } from '../members';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const idParams = z.object({ id: z.string() });

export const evidenceSchema = z
  .object({
    id: z.string(),
    contentType: z.enum(evidenceContentTypes),
    size: z.number().int().openapi({ description: 'Bytes' }),
    createdAt: z.iso.datetime(),
  })
  .openapi('Evidence', { description: 'A screenshot attached to a price record, read through GET /evidence/{id}' });

const maxFilesPerUpload = 10;

const file = z.instanceof(File).openapi({ type: 'string', format: 'binary' });

export function evidenceRoutes(db: Database, auth: Auth, store: EvidenceStore) {
  const middleware = requireMember(auth, db);
  const unauthenticated = { 401: { description: 'Not signed in' } };
  const notFound = { 404: { description: 'No such evidence in this household', content: errorContent } };

  const uploadRoute = createRoute({
    method: 'post',
    path: '/price-records/{id}/evidence',
    tags: ['evidence'],
    summary: 'Attach one or more screenshots to a price record',
    middleware,
    request: {
      params: idParams,
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              files: z.union([file, z.array(file).min(1).max(maxFilesPerUpload)]).openapi({
                description:
                  'Up to 10 PNG, JPEG, WebP or GIF images of at most 10 MB each, under repeated "files" fields',
              }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      201: { description: 'Attached', content: { 'application/json': { schema: z.array(evidenceSchema) } } },
      ...unauthenticated,
      404: { description: 'No such price record in this household', content: errorContent },
      413: {
        description: 'A file is over 10 MB, or the upload as a whole too large (evidence_too_large)',
        content: errorContent,
      },
      422: { description: 'A file is not a supported image (unsupported_evidence_type)', content: errorContent },
    },
  });

  const readRoute = createRoute({
    method: 'get',
    path: '/evidence/{id}',
    tags: ['evidence'],
    summary: 'Read a piece of evidence',
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

  const deleteRoute = createRoute({
    method: 'delete',
    path: '/evidence/{id}',
    tags: ['evidence'],
    summary: 'Delete a piece of evidence',
    middleware,
    request: { params: idParams },
    responses: { 204: { description: 'Deleted' }, ...unauthenticated, ...notFound },
  });

  const app = new OpenAPIHono();
  app.use(
    '/price-records/:id/evidence',
    // Bounds what is read into memory before any single file's size is checked.
    bodyLimit({
      maxSize: maxFilesPerUpload * maxEvidenceSize + 1024 * 1024,
      onError: (c) => c.json({ error: 'evidence_too_large' }, 413),
    }),
  );
  return app
    .openapi(uploadRoute, async (c) => {
      const { files } = c.req.valid('form');
      const list = Array.isArray(files) ? files : [files];
      if (list.some((f) => f.size > maxEvidenceSize)) return c.json({ error: 'evidence_too_large' }, 413);
      const contents = await Promise.all(list.map(async (f) => new Uint8Array(await f.arrayBuffer())));
      try {
        const added = await addEvidence(db, store, c.var.member, c.req.valid('param').id, contents);
        return added
          ? c.json(
              added.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
              201,
            )
          : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        if (error instanceof EvidenceTooLargeError) return c.json({ error: 'evidence_too_large' }, 413);
        if (error instanceof UnsupportedEvidenceTypeError) return c.json({ error: 'unsupported_evidence_type' }, 422);
        throw error;
      }
    })
    .openapi(readRoute, async (c) => {
      const found = await readEvidence(db, store, c.var.member, c.req.valid('param').id);
      if (!found) return c.json({ error: 'not_found' }, 404);
      return c.body(found.bytes, 200, {
        'content-type': found.contentType,
        'x-content-type-options': 'nosniff',
        // Evidence never changes under its id, but stays private to the browser that fetched it.
        'cache-control': 'private, max-age=31536000, immutable',
      });
    })
    .openapi(deleteRoute, async (c) => {
      const deleted = await deleteEvidence(db, store, c.var.member, c.req.valid('param').id);
      return deleted ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
    });
}
