import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import type { Database } from '../db';

const route = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Report whether the service and its database are up',
  responses: {
    200: {
      description: 'Service is healthy',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
});

export function healthRoutes(db: Database) {
  return new OpenAPIHono().openapi(route, async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ status: 'ok' as const }, 200);
  });
}
