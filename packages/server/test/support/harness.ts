import { afterAll, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { createApp, type AppOptions } from '../../src/app';
import { createAuth, type Auth } from '../../src/auth';
import { connect, migrate, type Database } from '../../src/db';
import { localEvidenceStore } from '../../src/evidence-store';
import { createHousehold } from '../../src/households';
import { fetchClaudeMetadata } from './claude-metadata';

const adminUrl =
  process.env.STOCKUP_TEST_DATABASE_URL ?? 'postgres://stockup:stockup@127.0.0.1:55432/postgres';

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
  evidenceDir: string;
}

// Registers suite-level hooks that give the calling test file its own migrated database
// and evidence directory. With `listen`, the app also serves HTTP on a free port, which the MCP endpoint
// needs because it fetches the signing keys from its own base URL.
export function useTestApp({ listen = false, ...options }: Omit<AppOptions, 'db' | 'auth' | 'evidence'> & { listen?: boolean } = {}) {
  const ctx = {} as TestContext;
  let server: ReturnType<typeof Bun.serve> | undefined;
  beforeAll(async () => {
    ctx.database = await createTestDatabase();
    ctx.evidenceDir = mkdtempSync(path.join(tmpdir(), 'stockup-evidence-'));
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
      evidence: localEvidenceStore(ctx.evidenceDir),
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

// The household's admin invites a new member, who registers through the invitation and is signed in.
export async function joinHousehold(ctx: TestContext, admin: SignedInMember): Promise<SignedInMember> {
  const invited = await admin.request('/api/invitations', jsonRequest('POST', { expiresInDays: 1 }));
  if (invited.status !== 201) throw new Error(`invitation failed with ${invited.status}: ${await invited.text()}`);
  const { id } = (await invited.json()) as { id: string };

  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `member_${suffix}`;
  const password = `password-${suffix}`;
  const account = { username, password, name: `Member ${suffix}` };
  const res = await ctx.app.request(`/api/join/${id}`, jsonRequest('POST', account));
  if (res.status !== 201) throw new Error(`joining failed with ${res.status}: ${await res.text()}`);
  const { userId, householdId } = (await res.json()) as { userId: string; householdId: string };
  const cookie = sessionCookie(res);
  return {
    userId,
    householdId,
    username,
    name: account.name,
    password,
    cookie,
    request: (path, init) => requestAs(ctx, cookie, path, init),
  };
}

export async function signIn(ctx: TestContext, username: string, password: string) {
  const res = await ctx.app.request('/api/auth/sign-in/username', jsonRequest('POST', { username, password }));
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
