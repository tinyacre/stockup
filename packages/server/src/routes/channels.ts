import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import { createChannel, deleteChannel, findChannel, lastUsedChannel, listChannels, updateChannel } from '../channels';
import type { Database } from '../db';
import { NameTakenError, NotEmptyError } from '../db/errors';
import { requireMember } from '../members';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };
const name = z.string().trim().min(1).max(50);
const idParams = z.object({ id: z.string() });

export const channelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    archived: z.boolean().openapi({ description: 'Archived channels are left out of the default list' }),
  })
  .openapi('Channel');

const channelChangesSchema = z
  .object({ name: name.optional(), archived: z.boolean().optional() })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Provide at least one field to change',
  });

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

function respondToError(c: Context, error: unknown) {
  if (error instanceof NameTakenError) return c.json({ error: 'name_taken' }, 409);
  if (error instanceof NotEmptyError) return c.json({ error: 'in_use' }, 409);
  throw error;
}

export function channelRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db);
  const unauthenticated = { 401: { description: 'Not signed in' } };
  const notFound = { 404: { description: 'No such channel in this household', content: errorContent } };
  const nameTaken = { 409: { description: 'The household already uses this name', content: errorContent } };
  const channelContent = { 'application/json': { schema: channelSchema } };

  const listRoute = createRoute({
    method: 'get',
    path: '/channels',
    tags: ['channels'],
    summary: "List the household's channels",
    middleware,
    request: {
      query: z.object({
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true')
          .openapi({ description: 'Also list archived channels' }),
      }),
    },
    responses: {
      200: { description: 'Channels', content: { 'application/json': { schema: z.array(channelSchema) } } },
      ...unauthenticated,
    },
  });

  const lastUsedRoute = createRoute({
    method: 'get',
    path: '/channels/last-used',
    tags: ['channels'],
    summary: "Get the unarchived channel of the signed-in member's most recently entered price record",
    middleware,
    responses: {
      200: {
        description: 'The channel, or null before the member has recorded a price in an unarchived channel',
        content: { 'application/json': { schema: z.object({ channel: channelSchema.nullable() }) } },
      },
      ...unauthenticated,
    },
  });

  const getRoute = createRoute({
    method: 'get',
    path: '/channels/{id}',
    tags: ['channels'],
    summary: 'Get a channel, archived or not',
    middleware,
    request: { params: idParams },
    responses: { 200: { description: 'The channel', content: channelContent }, ...unauthenticated, ...notFound },
  });

  const createChannelRoute = createRoute({
    method: 'post',
    path: '/channels',
    tags: ['channels'],
    summary: 'Create a channel',
    middleware,
    request: { body: json(z.object({ name })) },
    responses: { 201: { description: 'Created', content: channelContent }, ...unauthenticated, ...nameTaken },
  });

  const updateRoute = createRoute({
    method: 'patch',
    path: '/channels/{id}',
    tags: ['channels'],
    summary: 'Rename, archive or restore a channel',
    middleware,
    request: { params: idParams, body: json(channelChangesSchema) },
    responses: {
      200: { description: 'Updated', content: channelContent },
      ...unauthenticated,
      ...notFound,
      ...nameTaken,
    },
  });

  const deleteRoute = createRoute({
    method: 'delete',
    path: '/channels/{id}',
    tags: ['channels'],
    summary: 'Delete a channel that no price record names',
    middleware,
    request: { params: idParams },
    responses: {
      204: { description: 'Deleted' },
      ...unauthenticated,
      ...notFound,
      409: { description: 'Price records name this channel; archive it instead', content: errorContent },
    },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => {
      const { includeArchived } = c.req.valid('query');
      return c.json(await listChannels(db, c.var.member, { includeArchived }), 200);
    })
    .openapi(lastUsedRoute, async (c) => c.json({ channel: await lastUsedChannel(db, c.var.member) }, 200))
    .openapi(getRoute, async (c) => {
      const found = await findChannel(db, c.var.member, c.req.valid('param').id);
      return found ? c.json(found, 200) : c.json({ error: 'not_found' }, 404);
    })
    .openapi(createChannelRoute, async (c) => {
      try {
        return c.json(await createChannel(db, c.var.member, c.req.valid('json')), 201);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(updateRoute, async (c) => {
      try {
        const updated = await updateChannel(db, c.var.member, c.req.valid('param').id, c.req.valid('json'));
        return updated ? c.json(updated, 200) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(deleteRoute, async (c) => {
      try {
        const deleted = await deleteChannel(db, c.var.member, c.req.valid('param').id);
        return deleted ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    });
}
