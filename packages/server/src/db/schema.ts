import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Discount } from '@stockup/domain';
import type { RecognitionResult } from '../recognizer';
import { organization, user } from './auth-schema';

export * from './auth-schema';

const monthDay = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.source;

// A household's promotions recur every year, so each range is stored as month-day bounds ("MM-DD");
// a range whose end precedes its start wraps across the new year.
export const promotion = pgTable(
  'promotion',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
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
    unique('promotion_household_id_unique').on(table.householdId, table.id),
    check('promotion_starts_on_check', sql`${table.startsOn} ~ ${sql.raw(`'${monthDay}'`)}`),
    check('promotion_ends_on_check', sql`${table.endsOn} ~ ${sql.raw(`'${monthDay}'`)}`),
  ],
);

export const categoryGroup = pgTable(
  'category_group',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
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
    unique('category_household_id_group_unique').on(table.householdId, table.id, table.categoryGroupId),
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    categoryGroupId: text('category_group_id').notNull(),
    // Null for a product placed directly in its category group.
    categoryId: text('category_id'),
    name: text('name').notNull(),
    pricingUnitDimension: text('pricing_unit_dimension', { enum: unitDimensions }).notNull(),
    pricingUnitName: text('pricing_unit_name').notNull(),
    // Expressed in the pricing unit.
    baseSize: doublePrecision('base_size').notNull(),
    // Cents per Base Size; null until the household sets one.
    stockLine: integer('stock_line'),
    note: text('note').notNull().default(''),
    // Archiving keeps the product and its price records while leaving it out of search.
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('product_household_id_unique').on(table.householdId, table.id),
    index('product_household_category_idx').on(table.householdId, table.categoryId),
    index('product_household_group_idx').on(table.householdId, table.categoryGroupId),
    foreignKey({
      name: 'product_category_group_fk',
      columns: [table.householdId, table.categoryGroupId],
      foreignColumns: [categoryGroup.householdId, categoryGroup.id],
    }),
    // Carries the category's group, so moving a category to another group moves its products along.
    foreignKey({
      name: 'product_category_fk',
      columns: [table.householdId, table.categoryId, table.categoryGroupId],
      foreignColumns: [category.householdId, category.id, category.categoryGroupId],
    }).onUpdate('cascade'),
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
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

// A record's product, channel and promotion are referenced through (household_id, id) like the catalog's
// parents, so a record cannot point into another household, and each stays while records name it.
export const priceRecord = pgTable(
  'price_record',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
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
    // Tagged from the date when the record is written unless the member picks one or none.
    promotionId: text('promotion_id'),
    note: text('note').notNull().default(''),
    // Null once the member's account is gone; the record itself stays with the household.
    recordedBy: text('recorded_by').references(() => user.id, { onDelete: 'set null' }),
    source: text('source', { enum: priceRecordSources }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('price_record_household_product_date_idx').on(table.householdId, table.productId, table.date),
    unique('price_record_household_id_unique').on(table.householdId, table.id),
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
    foreignKey({
      name: 'price_record_promotion_fk',
      columns: [table.householdId, table.promotionId],
      foreignColumns: [promotion.householdId, promotion.id],
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
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

export const evidenceContentTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

// The file itself sits in the evidence store under the row's id. Rows go with their price record,
// and whoever deletes the record removes the files.
export const evidence = pgTable(
  'evidence',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Orders Evidence as it was uploaded; pieces uploaded together share their created_at.
    sequence: integer('sequence').generatedAlwaysAsIdentity().notNull(),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    priceRecordId: text('price_record_id').notNull(),
    contentType: text('content_type', { enum: evidenceContentTypes }).notNull(),
    // Bytes.
    size: integer('size').notNull(),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('evidence_household_price_record_idx').on(table.householdId, table.priceRecordId),
    foreignKey({
      name: 'evidence_price_record_fk',
      columns: [table.householdId, table.priceRecordId],
      foreignColumns: [priceRecord.householdId, priceRecord.id],
    }).onDelete('cascade'),
    check(
      'evidence_content_type_check',
      sql`${table.contentType} in (${sql.raw(evidenceContentTypes.map((t) => `'${t}'`).join(', '))})`,
    ),
    check('evidence_size_check', sql`${table.size} > 0`),
  ],
);

export const recognitionStatuses = ['pending', 'succeeded', 'failed'] as const;
export const recognitionErrors = ['recognition_unavailable', 'recognition_failed', 'recognition_interrupted'] as const;

// A member's request to read a screenshot into Recognition Drafts. The screenshot sits in the evidence
// store under the row's id.
export const recognition = pgTable(
  'recognition',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
    status: text('status', { enum: recognitionStatuses }).notNull(),
    error: text('error', { enum: recognitionErrors }),
    screenshotContentType: text('screenshot_content_type', { enum: evidenceContentTypes }).notNull(),
    // Bytes.
    screenshotSize: integer('screenshot_size').notNull(),
    // What the recognizer answered, kept as it came for auditing; drafts hold the parsed lines.
    result: jsonb('result').$type<RecognitionResult>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
    // Set once its drafts have been written as price records, which also removes the drafts.
    confirmedAt: timestamp('confirmed_at'),
  },
  (table) => [
    unique('recognition_household_id_unique').on(table.householdId, table.id),
    check(
      'recognition_status_check',
      sql`${table.status} in (${sql.raw(recognitionStatuses.map((s) => `'${s}'`).join(', '))})`,
    ),
    check('recognition_error_check', sql`(${table.status} = 'failed') = (${table.error} is not null)`),
    check(
      'recognition_screenshot_content_type_check',
      sql`${table.screenshotContentType} in (${sql.raw(evidenceContentTypes.map((t) => `'${t}'`).join(', '))})`,
    ),
  ],
);

// One line of goods read from a recognition's screenshot, waiting for a member to confirm it.
export const recognitionDraft = pgTable(
  'recognition_draft',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text('household_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    recognitionId: text('recognition_id').notNull(),
    // Keeps drafts in the order the screenshot lists them.
    position: integer('position').notNull(),
    name: text('name').notNull(),
    sizeText: text('size_text'),
    // Null, like the other values, until it is read from the screenshot or entered.
    sizeAmount: doublePrecision('size_amount'),
    sizeUnitDimension: text('size_unit_dimension', { enum: unitDimensions }),
    sizeUnitName: text('size_unit_name'),
    quantity: integer('quantity'),
    // Cents.
    listPrice: integer('list_price'),
    discounts: jsonb('discounts').$type<Discount[]>().notNull(),
    // Cents: this draft's share of the order discounts, null while a draft's list price is unknown.
    orderDiscount: integer('order_discount'),
    // The suggested or chosen product. Deleting the product clears only this column (see the migration),
    // and merging moves it to the kept product.
    productId: text('product_id'),
  },
  (table) => [
    uniqueIndex('recognition_draft_recognition_position_uidx').on(table.recognitionId, table.position),
    index('recognition_draft_household_product_idx').on(table.householdId, table.productId),
    foreignKey({
      name: 'recognition_draft_recognition_fk',
      columns: [table.householdId, table.recognitionId],
      foreignColumns: [recognition.householdId, recognition.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'recognition_draft_product_fk',
      columns: [table.householdId, table.productId],
      foreignColumns: [product.householdId, product.id],
    }).onDelete('set null'),
    check('recognition_draft_order_discount_check', sql`${table.orderDiscount} >= 0`),
    check(
      'recognition_draft_size_check',
      sql`(${table.sizeAmount} is null) = (${table.sizeUnitDimension} is null)
        and (${table.sizeAmount} is null) = (${table.sizeUnitName} is null)`,
    ),
  ],
);

export const emailCodePurposes = ['register', 'join', 'password-reset', 'change-email'] as const;

// The latest verification code mailed to an address for one purpose, and the send history that rate-limits it.
export const emailCode = pgTable(
  'email_code',
  {
    // Lowercase.
    email: text('email').notNull(),
    purpose: text('purpose', { enum: emailCodePurposes }).notNull(),
    // HMAC of the code keyed with the auth secret; null once redeemed, or when the send was counted but not mailed.
    codeHash: text('code_hash'),
    expiresAt: timestamp('expires_at').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    sentAt: timestamp('sent_at').notNull(),
    // Send times within the last hour, the sliding window of the hourly limit.
    recentSends: timestamp('recent_sends').array().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.email, table.purpose] }),
    check(
      'email_code_purpose_check',
      sql`${table.purpose} in (${sql.raw(emailCodePurposes.map((p) => `'${p}'`).join(', '))})`,
    ),
  ],
);
