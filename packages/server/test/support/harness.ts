import { afterAll, beforeAll } from 'bun:test';
import postgres from 'postgres';
import { createApp, type AppOptions } from '../../src/app';
import { connect, migrate, type Database } from '../../src/db';

const adminUrl =
  process.env.STOCKUP_TEST_DATABASE_URL ?? 'postgres://stockup:stockup@127.0.0.1:55432/postgres';

export interface TestDatabase {
  url: string;
  db: Database;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `stockup_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const conn = connect(url.toString());
  await migrate(conn.db);

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

// Registers suite-level hooks that give the calling test file its own migrated database.
export function useTestApp(options: Omit<AppOptions, 'db'> = {}) {
  const ctx = {} as { app: ReturnType<typeof createApp>; database: TestDatabase };
  beforeAll(async () => {
    ctx.database = await createTestDatabase();
    ctx.app = createApp({ ...options, db: ctx.database.db });
  });
  afterAll(() => ctx.database.drop());
  return ctx;
}
