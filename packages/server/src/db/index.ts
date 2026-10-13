import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate as runMigrations } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function connect(url: string) {
  const client = postgres(url, { onnotice: () => {} });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

export function migrate(db: Database) {
  return runMigrations(db, { migrationsFolder });
}
