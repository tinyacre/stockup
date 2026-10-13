import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization, user } from './auth-schema';

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
    // Cents per Base Size; null until the household sets one.
    stockLine: integer('stock_line'),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('product_household_id_unique').on(table.householdId, table.id),
    index('product_household_category_idx').on(table.householdId, table.categoryId),
    foreignKey({
      name: 'product_category_fk',
      columns: [table.householdId, table.categoryId],
      foreignColumns: [category.householdId, category.id],
    }),
    check('product_base_size_check', sql`${table.baseSize} > 0`),
    check('product_stock_line_check', sql`${table.stockLine} > 0`),
    check(
      'product_pricing_unit_dimension_check',
      sql`${table.pricingUnitDimension} in (${sql.raw(unitDimensions.map((d) => `'${d}'`).join(', '))})`,
    ),
  ],
);

// Archiving keeps a channel's row, so price records that name it keep pointing at it.
export const channel = pgTable(
  'channel',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('channel_household_name_uidx').on(table.householdId, table.name),
    unique('channel_household_id_unique').on(table.householdId, table.id),
  ],
);

export const priceRecordSources = ['manual', 'recognition', 'mcp'] as const;

// A record's product and channel are referenced through (household_id, id) like the catalog's
// parents, so a record cannot point into another household, and both stay while records name them.
export const priceRecord = pgTable(
  'price_record',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    channelId: text('channel_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    purchased: boolean('purchased').notNull(),
    // Cents.
    listPrice: integer('list_price').notNull(),
    quantity: integer('quantity').notNull(),
    // Converted to the product's pricing unit; the entered amount and unit are kept as typed.
    sizeAmount: doublePrecision('size_amount').notNull(),
    enteredSizeAmount: doublePrecision('entered_size_amount').notNull(),
    enteredSizeUnitName: text('entered_size_unit_name').notNull(),
    note: text('note').notNull().default(''),
    // Null once the member's account is gone; the record itself stays with the household.
    recordedBy: text('recorded_by').references(() => user.id, { onDelete: 'set null' }),
    source: text('source', { enum: priceRecordSources }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('price_record_household_product_date_idx').on(table.householdId, table.productId, table.date),
    foreignKey({
      name: 'price_record_product_fk',
      columns: [table.householdId, table.productId],
      foreignColumns: [product.householdId, product.id],
    }),
    foreignKey({
      name: 'price_record_channel_fk',
      columns: [table.householdId, table.channelId],
      foreignColumns: [channel.householdId, channel.id],
    }),
    check('price_record_list_price_check', sql`${table.listPrice} > 0`),
    check('price_record_quantity_check', sql`${table.quantity} > 0`),
    check('price_record_size_check', sql`${table.sizeAmount} > 0 and ${table.enteredSizeAmount} > 0`),
    check(
      'price_record_source_check',
      sql`${table.source} in (${sql.raw(priceRecordSources.map((s) => `'${s}'`).join(', '))})`,
    ),
  ],
);

export const discount = pgTable(
  'discount',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    priceRecordId: text('price_record_id')
      .notNull()
      .references(() => priceRecord.id, { onDelete: 'cascade' }),
    // Keeps discounts in the order they were entered.
    position: integer('position').notNull(),
    // Cents.
    amount: integer('amount').notNull(),
    name: text('name'),
  },
  (table) => [
    uniqueIndex('discount_price_record_position_uidx').on(table.priceRecordId, table.position),
    check('discount_amount_check', sql`${table.amount} > 0`),
  ],
);
