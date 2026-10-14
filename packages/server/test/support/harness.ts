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
  auth: Auth;
  database: TestDatabase;
  evidenceDir: string;
}

// Registers suite-level hooks that give the calling test file its own migrated database
// and evidence directory.
export function useTestApp(options: Omit<AppOptions, 'db' | 'auth' | 'evidence'> = {}) {
  const ctx = {} as TestContext;
  beforeAll(async () => {
    ctx.database = await createTestDatabase();
    ctx.evidenceDir = mkdtempSync(path.join(tmpdir(), 'stockup-evidence-'));
    ctx.auth = createAuth({ db: ctx.database.db, secret: testAuthSecret, baseURL: 'http://localhost' });
    ctx.app = createApp({
      ...options,
      db: ctx.database.db,
      auth: ctx.auth,
      evidence: localEvidenceStore(ctx.evidenceDir),
    });
  });
  afterAll(async () => {
    await ctx.database.drop();
    await rm(ctx.evidenceDir, { recursive: true, force: true });
  });
  return ctx;
}

export interface SignedInMember {
  userId: string;
  householdId: string;
  username: string;
  password: string;
  cookie: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}

// Each call creates a separate household whose admin is signed in, so a test can pit
// a member of one household against another household's data.
export async function signUpHousehold(ctx: TestContext): Promise<SignedInMember> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `member_${suffix}`;
  const password = `password-${suffix}`;
  const { userId, householdId } = await createHousehold(ctx.database.db, ctx.auth, {
    householdName: `Household ${suffix}`,
    admin: { username, password, name: `Member ${suffix}` },
  });
  const cookie = await signIn(ctx, username, password);
  return {
    userId,
    householdId,
    username,
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
