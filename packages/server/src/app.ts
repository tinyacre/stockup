import path from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { serveStatic } from 'hono/bun';
import { mcpAvailable, type Auth } from './auth';
import type { Database } from './db';
import type { EvidenceStore } from './evidence-store';
import { mcpRoutes } from './mcp';
import type { ScreenshotRecognizer } from './recognizer';
import { catalogRoutes } from './routes/catalog';
import { channelRoutes } from './routes/channels';
import { evidenceRoutes } from './routes/evidence';
import { healthRoutes } from './routes/health';
import { householdRoutes } from './routes/households';
import { invitationRoutes } from './routes/invitations';
import { judgmentRoutes } from './routes/judgments';
import { mcpClientRoutes } from './routes/mcp-clients';
import { meRoutes } from './routes/me';
import { memberRoutes } from './routes/members';
import { priceRecordRoutes } from './routes/price-records';
import { promotionRoutes } from './routes/promotions';
import { recognitionRoutes } from './routes/recognitions';
import { setupRoutes } from './routes/setup';

export interface AppOptions {
  db: Database;
  auth: Auth;
  evidence: EvidenceStore;
  // Recognition is unavailable without one.
  recognizer?: ScreenshotRecognizer;
  webDir?: string;
}

export function createApp({ db, auth, evidence, recognizer, webDir }: AppOptions) {
  const app = new OpenAPIHono()
    .route('/api', healthRoutes(db))
    .route('/api', setupRoutes(db, auth))
    .route('/api', meRoutes(db, auth))
    .route('/api', memberRoutes(db, auth))
    .route('/api', householdRoutes(db, auth))
    .route('/api', invitationRoutes(db, auth))
    .route('/api', promotionRoutes(db, auth))
    .route('/api', catalogRoutes(db, auth))
    .route('/api', channelRoutes(db, auth))
    .route('/api', priceRecordRoutes(db, auth, evidence))
    .route('/api', evidenceRoutes(db, auth, evidence))
    .route('/api', recognitionRoutes(db, auth, evidence, recognizer))
    .route('/api', judgmentRoutes(db, auth))
    .route('/api', mcpClientRoutes(db, auth));

  // Households are created and joined only through StockUp's own endpoints, which keep
  // each member in exactly one household; the organization plugin serves as storage.
  app.all('/api/auth/organization/*', (c) => c.json({ error: 'not_found' }, 404));
  // Members rename themselves through PATCH /api/me, which applies StockUp's name rules; usernames are fixed.
  app.all('/api/auth/update-user', (c) => c.json({ error: 'not_found' }, 404));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  if (mcpAvailable(auth.options.baseURL)) {
    // Discovery documents live outside /api/auth, where the mcp() plugin serves them only through auth.handler.
    app.on(['GET', 'HEAD'], '/.well-known/*', (c) => auth.handler(c.req.raw));
    app.route('/', mcpRoutes(db, auth));
  }

  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'StockUp API', version: '0.1.0' },
  });
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  if (webDir) {
    app.get('*', serveStatic({ root: webDir }));
    // Paths without a file extension are client-side routes owned by the SPA router.
    app.get('*', async (c, next) => {
      if (path.extname(c.req.path)) return next();
      return serveStatic({ root: webDir, path: 'index.html' })(c, next);
    });
  }

  return app;
}
