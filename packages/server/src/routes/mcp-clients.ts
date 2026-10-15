import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../auth';
import type { Database } from '../db';
import { listMcpClients, revokeMcpClient } from '../mcp-clients';
import { requireSession } from '../members';

const errorContent = { 'application/json': { schema: z.object({ error: z.string() }) } };

const mcpClientSchema = z
  .object({
    clientId: z.string().openapi({ description: "The URL of the client's metadata document" }),
    name: z.string().nullable(),
    uri: z.string().nullable(),
    scopes: z.array(z.string()),
    authorizedAt: z.iso.datetime(),
  })
  .openapi('McpClient');

// A member's authorizations are theirs, not the household's, so revoking them needs no household.
export function mcpClientRoutes(db: Database, auth: Auth) {
  const middleware = requireSession(auth);
  const unauthenticated = { 401: { description: 'Not signed in' } };

  const listRoute = createRoute({
    method: 'get',
    path: '/mcp-clients',
    tags: ['mcp'],
    summary: 'List the MCP clients the signed-in member has authorized, most recently authorized first',
    middleware,
    responses: {
      200: { description: 'Authorized clients', content: { 'application/json': { schema: z.array(mcpClientSchema) } } },
      ...unauthenticated,
    },
  });

  const revokeRoute = createRoute({
    method: 'delete',
    path: '/mcp-clients/{clientId}',
    tags: ['mcp'],
    summary: "Revoke the signed-in member's authorization of an MCP client; its tokens stop working at once",
    middleware,
    request: { params: z.object({ clientId: z.string() }) },
    responses: {
      204: { description: 'Revoked' },
      ...unauthenticated,
      404: { description: 'The member has not authorized this client', content: errorContent },
    },
  });

  return new OpenAPIHono()
    .openapi(listRoute, async (c) => {
      const clients = await listMcpClients(db, c.var.userId);
      return c.json(
        clients.map((client) => ({ ...client, authorizedAt: client.authorizedAt.toISOString() })),
        200,
      );
    })
    .openapi(revokeRoute, async (c) => {
      const revoked = await revokeMcpClient(db, c.var.userId, c.req.valid('param').clientId);
      return revoked ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
    });
}
