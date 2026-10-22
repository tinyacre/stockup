import path from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { serveStatic } from 'hono/bun';
import { mcpAvailable, type Auth } from './auth';
import type { Database } from './db';
import { createEmailCodes } from './email-codes';
import type { EvidenceStore } from './evidence-store';
import type { Mailer } from './mailer';
import { mcpRoutes } from './mcp';
import type { ScreenshotRecognizer } from './recognizer';
import { capabilityRoutes } from './routes/capabilities';
import { catalogRoutes } from './routes/catalog';
import { channelRoutes } from './routes/channels';
import { evidenceRoutes } from './routes/evidence';
import { healthRoutes } from './routes/health';
import { householdRoutes } from './routes/households';
import { invitationRoutes } from './routes/invitations';
import { judgmentRoutes } from './routes/judgments';
import { mcpClientRoutes } from './routes/mcp-clients';
import { passwordResetRoutes } from './routes/password-reset';
import { meRoutes } from './routes/me';
import { memberRoutes } from './routes/members';
import { priceRecordRoutes } from './routes/price-records';
import { promotionRoutes } from './routes/promotions';
import { recognitionRoutes } from './routes/recognitions';
import { setupRoutes } from './routes/setup';
import { signupRoutes } from './routes/signup';
import type { TurnstileVerifier } from './turnstile';

export interface AppOptions {
  db: Database;
  auth: Auth;
  evidence: EvidenceStore;
  // Recognition is unavailable without one.
  recognizer?: ScreenshotRecognizer;
  webDir?: string;
  // Email-based flows (code sending, signup, password reset) are unavailable without one.
  mailer?: Mailer;
  // Open signup; requires a mailer.
  signupOpen?: boolean;
  // Requests pass unchallenged without one.
  turnstile?: TurnstileVerifier;
}

export function createApp({ db, auth, evidence, recognizer, webDir, mailer, signupOpen = false, turnstile }: AppOptions) {
  if (signupOpen && !mailer) throw new Error('Open signup requires a mailer');
  const codes = mailer && createEmailCodes({ db, mailer, secret: auth.options.secret! });

  const app = new OpenAPIHono()
    .route('/api', healthRoutes(db))
    .route('/api', capabilityRoutes({ signupOpen, mailer, turnstile }))
    .route('/api', setupRoutes(db, auth))
    .route('/api', signupRoutes(db, auth, { codes, signupOpen }))
    .route('/api', passwordResetRoutes(auth, { codes }))
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
  // Addresses are verified with StockUp's own codes, which accounts are created or changed together with.
  app.all('/api/auth/send-verification-email', (c) => c.json({ error: 'not_found' }, 404));
  app.all('/api/auth/verify-email', (c) => c.json({ error: 'not_found' }, 404));
  // Passwords are reset with StockUp's emailed codes through POST /api/password-reset, which also ends every session.
  app.all('/api/auth/request-password-reset', (c) => c.json({ error: 'not_found' }, 404));
  app.all('/api/auth/reset-password/*', (c) => c.json({ error: 'not_found' }, 404));
  app.all('/api/auth/forget-password/*', (c) => c.json({ error: 'not_found' }, 404));
  // One field takes a username or an email, but the username endpoint rejects anything shaped like an email.
  app.post('/api/auth/sign-in/username', async (c) => {
    const body = (await c.req.raw.clone().json().catch(() => null)) as Record<string, unknown> | null;
    if (typeof body?.username !== 'string' || !body.username.includes('@')) return auth.handler(c.req.raw);
    const { username, password, rememberMe, callbackURL, oauth_query } = body;
    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');
    const url = new URL('/api/auth/sign-in/email', c.req.url).toString();
    const json = JSON.stringify({ email: username, password, rememberMe, callbackURL, oauth_query });
    return auth.handler(new Request(url, { method: 'POST', headers, body: json }));
  });
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  if (mcpAvailable(auth.options.baseURL)) {
    // Discovery documents live outside /api/auth, where the mcp() plugin serves them only through auth.handler.
    app.on(['GET', 'HEAD'], '/.well-known/*', (c) => auth.handler(c.req.raw));
    app.route('/', mcpRoutes(db, auth, evidence));
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
