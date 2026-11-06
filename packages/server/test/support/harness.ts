import { afterAll, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { createApp, type AppOptions } from '../../src/app';
import { createAuth, type Auth } from '../../src/auth';
import { connect, migrate, type Database } from '../../src/db';
import { localEvidenceStore, type EvidenceStore } from '../../src/evidence-store';
import { createHousehold } from '../../src/households';
import { s3EvidenceStore } from '../../src/s3-evidence-store';
import { fetchClaudeMetadata } from './claude-metadata';
import type { FakeMailer } from './fake-mailer';
import { PASSING_TURNSTILE_TOKEN } from './fake-turnstile';
import { testS3Config } from './s3';

const adminUrl = process.env.STOCKUP_TEST_DATABASE_URL ?? 'postgres://stockup:stockup@127.0.0.1:55432/postgres';

export interface TestDatabase {
  url: string;
  db: Database;
  drop(): Promise<void>;
}

export async function createTestDatabase({ migrated = true } = {}): Promise<TestDatabase> {
  const name = `stockup_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const conn = connect(url.toString());
  if (migrated) await migrate(conn.db);

  return {
    url: url.toString(),
    db: conn.db,
    async drop() {
      await conn.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export const testAuthSecret = 'stockup-test-secret-stockup-test-secret';

export interface TestContext {
  app: ReturnType<typeof createApp>;
  baseUrl: string;
  auth: Auth;
  database: TestDatabase;
  evidence: EvidenceStore;
  // Backs the local store; empty when the app uses S3.
  evidenceDir: string;
}

// Registers suite-level hooks that give the calling test file its own migrated database
// and evidence directory. With `listen`, the app also serves HTTP on a free port, which the MCP endpoint
// needs because it fetches the signing keys from its own base URL. With `evidenceStore: 's3'`, evidence goes
// to the test bucket from testS3Config() instead of the directory; a store passed in takes the place of both.
export function useTestApp({
  listen = false,
  evidenceStore = 'local',
  ...options
}: Omit<AppOptions, 'db' | 'auth' | 'evidence'> & {
  listen?: boolean;
  evidenceStore?: 'local' | 's3' | EvidenceStore;
} = {}) {
  const ctx = {} as TestContext;
  let server: ReturnType<typeof Bun.serve> | undefined;
  beforeAll(async () => {
    ctx.database = await createTestDatabase();
    ctx.evidenceDir = mkdtempSync(path.join(tmpdir(), 'stockup-evidence-'));
    ctx.evidence =
      typeof evidenceStore === 'object'
        ? evidenceStore
        : evidenceStore === 's3'
          ? s3EvidenceStore(testS3Config())
          : localEvidenceStore(ctx.evidenceDir);
    server = listen ? Bun.serve({ port: 0, fetch: (req) => ctx.app.fetch(req) }) : undefined;
    ctx.baseUrl = server?.url.origin ?? 'http://localhost';
    ctx.auth = createAuth({
      db: ctx.database.db,
      secret: testAuthSecret,
      baseURL: ctx.baseUrl,
      fetchClientMetadataResource: fetchClaudeMetadata,
    });
    await ctx.auth.$context;
    ctx.app = createApp({
      ...options,
      db: ctx.database.db,
      auth: ctx.auth,
      evidence: ctx.evidence,
    });
  });
  afterAll(async () => {
    await server?.stop(true);
    await ctx.database.drop();
    await rm(ctx.evidenceDir, { recursive: true, force: true });
  });
  return ctx;
}

export interface SignedInMember {
  userId: string;
  householdId: string;
  username: string;
  name: string;
  password: string;
  cookie: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}

// Each call creates a separate household whose admin is signed in, so a test can pit
// a member of one household against another household's data.
export async function signUpHousehold(ctx: TestContext, { instanceAdmin = false } = {}): Promise<SignedInMember> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `member_${suffix}`;
  const password = `password-${suffix}`;
  const { userId, householdId } = await createHousehold(ctx.database.db, ctx.auth, {
    householdName: `Household ${suffix}`,
    admin: { username, password, name: `Member ${suffix}` },
    instanceAdmin,
  });
  const cookie = await signIn(ctx, username, password);
  return {
    userId,
    householdId,
    username,
    name: `Member ${suffix}`,
    password,
    cookie,
    request: (path, init) => requestAs(ctx, cookie, path, init),
  };
}

// Registers through open signup with an emailed code, so the member has a verified email and a household of their own.
// Requires an app with `signupOpen` and this mailer.
export async function signUpWithEmail(
  ctx: TestContext,
  mailer: FakeMailer,
): Promise<SignedInMember & { email: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `member_${suffix}@example.com`;
  const sent = await ctx.app.request(
    '/api/email-codes',
    challenged(jsonRequest('POST', { email, purpose: 'register' })),
  );
  if (sent.status !== 204) throw new Error(`sending a code failed with ${sent.status}: ${await sent.text()}`);
  const account = { username: `member_${suffix}`, password: `password-${suffix}`, name: `Member ${suffix}` };
  const res = await ctx.app.request(
    '/api/signup',
    challenged(jsonRequest('POST', { ...account, email, code: await mailer.codeFor(email) })),
  );
  if (res.status !== 201) throw new Error(`signup failed with ${res.status}: ${await res.text()}`);
  const { userId, householdId } = (await res.json()) as { userId: string; householdId: string };
  const cookie = sessionCookie(res);
  return {
    userId,
    householdId,
    ...account,
    email,
    cookie,
    request: (path, init) => requestAs(ctx, cookie, path, init),
  };
}

// The household's admin invites a new member, who registers through the invitation and is signed in.
// Pass the app's mailer when it has one: the invitee then verifies an email with a join code.
export async function joinHousehold(
  ctx: TestContext,
  admin: SignedInMember,
  { mailer }: { mailer?: FakeMailer } = {},
): Promise<SignedInMember & { email?: string }> {
  const invited = await admin.request('/api/invitations', jsonRequest('POST', { expiresInDays: 1 }));
  if (invited.status !== 201) throw new Error(`invitation failed with ${invited.status}: ${await invited.text()}`);
  const { id } = (await invited.json()) as { id: string };

  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `member_${suffix}`;
  const password = `password-${suffix}`;
  const account = { username, password, name: `Member ${suffix}` };
  let verified: { email: string; code: string } | undefined;
  if (mailer) {
    const email = `${username}@example.com`;
    const sent = await ctx.app.request(
      '/api/email-codes',
      challenged(jsonRequest('POST', { email, purpose: 'join', invitationId: id })),
    );
    if (sent.status !== 204) throw new Error(`sending a code failed with ${sent.status}: ${await sent.text()}`);
    verified = { email, code: await mailer.codeFor(email) };
  }
  const res = await ctx.app.request(`/api/join/${id}`, challenged(jsonRequest('POST', { ...account, ...verified })));
  if (res.status !== 201) throw new Error(`joining failed with ${res.status}: ${await res.text()}`);
  const { userId, householdId } = (await res.json()) as { userId: string; householdId: string };
  const cookie = sessionCookie(res);
  return {
    userId,
    householdId,
    username,
    name: account.name,
    password,
    email: verified?.email,
    cookie,
    request: (path, init) => requestAs(ctx, cookie, path, init),
  };
}

export async function signIn(ctx: TestContext, username: string, password: string) {
  const res = await ctx.app.request(
    '/api/auth/sign-in/username',
    challenged(jsonRequest('POST', { username, password })),
  );
  if (res.status !== 200) throw new Error(`sign-in failed with ${res.status}: ${await res.text()}`);
  return sessionCookie(res);
}

export function sessionCookie(res: Response) {
  const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token='));
  if (!cookie) throw new Error('response did not set a session cookie');
  return cookie.split(';')[0]!;
}

export async function requestAs(ctx: TestContext, cookie: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  return ctx.app.request(path, { ...init, headers });
}

// Carries the token fakeTurnstile() passes, so the helpers work whether or not the app checks one.
export function challenged(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('x-turnstile-token', PASSING_TURNSTILE_TOKEN);
  return { ...init, headers };
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// Records one purchase of a fresh product on a fresh channel, as the given member.
export async function recordPrice(m: SignedInMember) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const post = async (path: string, body: unknown) => {
    const res = await m.request(path, jsonRequest('POST', body));
    if (res.status !== 201) throw new Error(`${path} failed with ${res.status}: ${await res.text()}`);
    return (await res.json()) as { id: string };
  };
  const group = await post('/api/category-groups', { name: `Group ${suffix}` });
  const category = await post('/api/categories', { categoryGroupId: group.id, name: `Category ${suffix}` });
  const product = await post('/api/products', {
    categoryId: category.id,
    name: `Product ${suffix}`,
    pricingUnit: { dimension: 'count', name: '抽' },
    baseSize: 90,
  });
  const channel = await post('/api/channels', { name: `Channel ${suffix}` });
  await post('/api/price-records', {
    productId: product.id,
    date: '2026-10-01',
    channelId: channel.id,
    purchased: true,
    listPrice: 9900,
    discounts: [],
    quantity: 18,
    size: { amount: 130, unit: { dimension: 'count', name: '抽' } },
    note: '',
  });
  return { productId: product.id };
}

export async function recordersOf(m: SignedInMember, productId: string) {
  const res = await m.request(`/api/price-records?productId=${productId}`);
  if (res.status !== 200) throw new Error(`listing price records failed with ${res.status}`);
  const records = (await res.json()) as { recordedBy: { id: string; name: string } | null }[];
  return records.map((r) => r.recordedBy);
}
