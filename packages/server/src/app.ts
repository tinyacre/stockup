import path from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { serveStatic } from 'hono/bun';
import type { Database } from './db';
import { healthRoutes } from './routes/health';

export interface AppOptions {
  db: Database;
  webDir?: string;
}

export function createApp({ db, webDir }: AppOptions) {
  const app = new OpenAPIHono().route('/api', healthRoutes(db));

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
