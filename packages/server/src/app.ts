import path from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { serveStatic } from 'hono/bun';
import type { Auth } from './auth';
import type { Database } from './db';
import { catalogRoutes } from './routes/catalog';
import { channelRoutes } from './routes/channels';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { promotionRoutes } from './routes/promotions';
import { setupRoutes } from './routes/setup';

export interface AppOptions {
  db: Database;
  auth: Auth;
  webDir?: string;
}

export function createApp({ db, auth, webDir }: AppOptions) {
  const app = new OpenAPIHono()
    .route('/api', healthRoutes(db))
    .route('/api', setupRoutes(db, auth))
    .route('/api', meRoutes(db, auth))
    .route('/api', promotionRoutes(db, auth))
    .route('/api', catalogRoutes(db, auth))
    .route('/api', channelRoutes(db, auth));

  // Households are created and joined only through StockUp's own endpoints, which keep
  // each member in exactly one household; the organization plugin serves as storage.
  app.all('/api/auth/organization/*', (c) => c.json({ error: 'not_found' }, 404));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

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
