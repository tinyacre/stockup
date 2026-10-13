import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.STOCKUP_DATABASE_URL ?? 'postgres://stockup:stockup@127.0.0.1:55432/stockup',
  },
});
