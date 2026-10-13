import { afterAll, beforeAll } from 'bun:test';
import postgres from 'postgres';
import { createApp, type AppOptions } from '../../src/app';
import { createAuth, type Auth } from '../../src/auth';
import { connect, migrate, type Database } from '../../src/db';
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
}

// Registers suite-level hooks that give the calling test file its own migrated database.
export function useTestApp(options: Omit<AppOptions, 'db' | 'auth'> = {}) {
  const ctx = {} as TestContext;
  beforeAll(async () => {
    ctx.database = await createTestDatabase();
    ctx.auth = createAuth({ db: ctx.database.db, secret: testAuthSecret, baseURL: 'http://localhost' });
    ctx.app = createApp({ ...options, db: ctx.database.db, auth: ctx.auth });
  });
  afterAll(() => ctx.database.drop());
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
