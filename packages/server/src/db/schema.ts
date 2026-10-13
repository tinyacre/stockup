import { check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization } from './auth-schema';

export * from './auth-schema';

const monthDay = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.source;

// A household's promotions recur every year, so each range is stored as month-day bounds ("MM-DD");
// a range whose end precedes its start wraps across the new year.
export const promotion = pgTable(
  'promotion',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startsOn: text('starts_on').notNull(),
    endsOn: text('ends_on').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('promotion_household_name_uidx').on(table.householdId, table.name),
    check('promotion_starts_on_check', sql`${table.startsOn} ~ ${sql.raw(`'${monthDay}'`)}`),
    check('promotion_ends_on_check', sql`${table.endsOn} ~ ${sql.raw(`'${monthDay}'`)}`),
  ],
);
