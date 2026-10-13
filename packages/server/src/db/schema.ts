import { check, doublePrecision, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
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

export const categoryGroup = pgTable(
  'category_group',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('category_group_household_name_uidx').on(table.householdId, table.name),
    unique('category_group_household_id_unique').on(table.householdId, table.id),
  ],
);

// Children reference their parent through (household_id, id), so a row can only ever hang
// under a parent from the same household, and a parent with children cannot be deleted.
export const category = pgTable(
  'category',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    categoryGroupId: text('category_group_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('category_household_name_uidx').on(table.householdId, table.name),
    unique('category_household_id_unique').on(table.householdId, table.id),
    index('category_household_group_idx').on(table.householdId, table.categoryGroupId),
    foreignKey({
      name: 'category_category_group_fk',
      columns: [table.householdId, table.categoryGroupId],
      foreignColumns: [categoryGroup.householdId, categoryGroup.id],
    }),
  ],
);

export const unitDimensions = ['weight', 'volume', 'count'] as const;

export const product = pgTable(
  'product',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
    name: text('name').notNull(),
    pricingUnitDimension: text('pricing_unit_dimension', { enum: unitDimensions }).notNull(),
    pricingUnitName: text('pricing_unit_name').notNull(),
    // Expressed in the pricing unit.
    baseSize: doublePrecision('base_size').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('product_household_category_idx').on(table.householdId, table.categoryId),
    foreignKey({
      name: 'product_category_fk',
      columns: [table.householdId, table.categoryId],
      foreignColumns: [category.householdId, category.id],
    }),
    check('product_base_size_check', sql`${table.baseSize} > 0`),
    check(
      'product_pricing_unit_dimension_check',
      sql`${table.pricingUnitDimension} in (${sql.raw(unitDimensions.map((d) => `'${d}'`).join(', '))})`,
    ),
  ],
);
