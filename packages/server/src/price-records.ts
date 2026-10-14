import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { calculatePrice, convert, matchPromotion, type Discount, type Size, type Unit } from '@stockup/domain';
import type { Database } from './db';
import { ParentNotFoundError, translate } from './db/errors';
import { channel, discount, priceRecord, product, promotion, user } from './db/schema';
import type { CurrentMember } from './members';
import { findPromotion, listPromotions } from './promotions';

export class ProductNotFoundError extends Error {
  override name = 'ProductNotFoundError';
}

// The record's prices fail the domain rules, such as discounts that leave nothing to pay.
export class InvalidPriceError extends Error {
  override name = 'InvalidPriceError';
}

export class PromotionNotFoundError extends Error {
  override name = 'PromotionNotFoundError';
}

export interface PricedInput {
  listPrice: number;
  discounts: Discount[];
  quantity: number;
  size: Size;
}

export interface PriceRecordInput extends PricedInput {
  date: string;
  channelId: string;
  purchased: boolean;
  // Null for none; omitted to tag the Promotion the date falls in on create, or to keep the tag on replace.
  promotionId?: string | null;
  note?: string;
}

export interface NewPriceRecord extends PriceRecordInput {
  productId: string;
}

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

const columns = {
  id: priceRecord.id,
  productId: priceRecord.productId,
  date: priceRecord.date,
  purchased: priceRecord.purchased,
  listPrice: priceRecord.listPrice,
  quantity: priceRecord.quantity,
  sizeAmount: priceRecord.sizeAmount,
  enteredSizeAmount: priceRecord.enteredSizeAmount,
  enteredSizeUnitName: priceRecord.enteredSizeUnitName,
  note: priceRecord.note,
  source: priceRecord.source,
  channelId: channel.id,
  channelName: channel.name,
  channelArchivedAt: channel.archivedAt,
  promotionId: promotion.id,
  promotionName: promotion.name,
  recordedById: user.id,
  recordedByName: user.name,
  pricingUnitDimension: product.pricingUnitDimension,
  pricingUnitName: product.pricingUnitName,
  baseSize: product.baseSize,
};

// Callers add the where clause, which must scope the rows to the member's household.
function selectRecords(db: Executor) {
  return db
    .select(columns)
    .from(priceRecord)
    .innerJoin(product, and(eq(product.householdId, priceRecord.householdId), eq(product.id, priceRecord.productId)))
    .innerJoin(channel, and(eq(channel.householdId, priceRecord.householdId), eq(channel.id, priceRecord.channelId)))
    .leftJoin(
      promotion,
      and(eq(promotion.householdId, priceRecord.householdId), eq(promotion.id, priceRecord.promotionId)),
    )
    .leftJoin(user, eq(user.id, priceRecord.recordedBy))
    .$dynamic();
}

type Row = Awaited<ReturnType<typeof selectRecords>>[number];

async function withDiscounts(db: Executor, rows: Row[]) {
  const ids = rows.map((r) => r.id);
  const discounts = ids.length
    ? await db
        .select({ priceRecordId: discount.priceRecordId, amount: discount.amount, name: discount.name })
        .from(discount)
        .where(inArray(discount.priceRecordId, ids))
        .orderBy(asc(discount.position))
    : [];
  const byRecord = new Map<string, Discount[]>();
  for (const { priceRecordId, amount, name } of discounts) {
    byRecord.set(priceRecordId, [...(byRecord.get(priceRecordId) ?? []), name === null ? { amount } : { amount, name }]);
  }
  return rows.map((row) => toPriceRecord(row, byRecord.get(row.id) ?? []));
}

// Prices are computed on every read from the product's current Pricing Unit and Base Size,
// so changing the Base Size re-expresses every Unit Price.
function toPriceRecord(row: Row, discounts: Discount[]) {
  const pricingUnit = { dimension: row.pricingUnitDimension, name: row.pricingUnitName } as Unit;
  const size = { amount: row.sizeAmount, unit: pricingUnit };
  const { netPrice, unitPrice } = calculatePrice({
    listPrice: row.listPrice,
    discounts,
    quantity: row.quantity,
    size,
    pricingUnit,
    baseSize: row.baseSize,
  });
  return {
    id: row.id,
    productId: row.productId,
    date: row.date,
    channel: { id: row.channelId, name: row.channelName, archived: row.channelArchivedAt !== null },
    purchased: row.purchased,
    promotion: row.promotionId === null ? null : { id: row.promotionId, name: row.promotionName! },
    listPrice: row.listPrice,
    discounts,
    quantity: row.quantity,
    size,
    enteredSize: {
      amount: row.enteredSizeAmount,
      unit: { dimension: pricingUnit.dimension, name: row.enteredSizeUnitName } as Unit,
    },
    note: row.note,
    recordedBy: row.recordedById === null ? null : { id: row.recordedById, name: row.recordedByName! },
    source: row.source,
    netPrice,
    unitPrice,
  };
}

export interface PriceRecordFilter {
  // Without products, lists the records of every product in the household.
  productIds?: string[];
  purchased?: boolean;
  channelId?: string;
  // Null for the records without a promotion.
  promotionId?: string | null;
}

export async function listPriceRecords(db: Database, scope: CurrentMember, filter: PriceRecordFilter = {}) {
  const { productIds, purchased, channelId, promotionId } = filter;
  if (productIds?.length === 0) return [];
  const rows = await selectRecords(db)
    .where(
      and(
        eq(priceRecord.householdId, scope.householdId),
        productIds === undefined ? undefined : inArray(priceRecord.productId, productIds),
        purchased === undefined ? undefined : eq(priceRecord.purchased, purchased),
        channelId === undefined ? undefined : eq(priceRecord.channelId, channelId),
        promotionId === undefined
          ? undefined
          : promotionId === null
            ? isNull(priceRecord.promotionId)
            : eq(priceRecord.promotionId, promotionId),
      ),
    )
    .orderBy(desc(priceRecord.date), desc(priceRecord.createdAt), desc(priceRecord.id));
  return withDiscounts(db, rows);
}

export async function findPriceRecord(db: Executor, scope: CurrentMember, id: string) {
  const rows = await selectRecords(db).where(
    and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, id)),
  );
  const [found] = await withDiscounts(db, rows);
  return found ?? null;
}

export async function lowestUnitPrice(db: Database, scope: CurrentMember, productId: string) {
  return (await summarizePrices(db, scope, [productId])).get(productId)!.lowestUnitPrice;
}

export interface PriceSummary {
  lowestUnitPrice: number | null;
  latestPrice: { date: string; unitPrice: number } | null;
}

export async function summarizePrices(db: Database, scope: CurrentMember, productIds: string[]) {
  const summaries = new Map<string, PriceSummary>(
    productIds.map((id) => [id, { lowestUnitPrice: null, latestPrice: null }]),
  );
  for (const r of await listPriceRecords(db, scope, { productIds })) {
    const summary = summaries.get(r.productId)!;
    summary.latestPrice ??= { date: r.date, unitPrice: r.unitPrice };
    if (summary.lowestUnitPrice === null || r.unitPrice < summary.lowestUnitPrice) summary.lowestUnitPrice = r.unitPrice;
  }
  return summaries;
}

interface Pricing {
  pricingUnit: Unit;
  baseSize: number;
}

export function priceFor(pricing: Pricing, input: PricedInput) {
  try {
    return calculatePrice({ ...input, ...pricing });
  } catch (error) {
    if (error instanceof RangeError) throw new InvalidPriceError(error.message);
    throw error;
  }
}

// Returns undefined to leave a replaced record's tag as it is.
async function promotionIdFor(db: Executor, scope: CurrentMember, input: PriceRecordInput, replacing: boolean) {
  if (input.promotionId === null) return null;
  if (input.promotionId === undefined) {
    if (replacing) return undefined;
    return matchPromotion(input.date, await listPromotions(db, scope))?.id ?? null;
  }
  if (!(await findPromotion(db, scope, input.promotionId))) throw new PromotionNotFoundError();
  return input.promotionId;
}

// Checks the input against the product with the domain rules and returns the columns to store.
async function recordValues(
  db: Executor,
  scope: CurrentMember,
  pricing: Pricing,
  input: PriceRecordInput,
  replacing = false,
) {
  const sizeAmount = convert(input.size.amount, input.size.unit, pricing.pricingUnit);
  priceFor(pricing, input);
  return {
    date: input.date,
    channelId: input.channelId,
    promotionId: await promotionIdFor(db, scope, input, replacing),
    purchased: input.purchased,
    listPrice: input.listPrice,
    quantity: input.quantity,
    sizeAmount,
    enteredSizeAmount: input.size.amount,
    enteredSizeUnitName: input.size.unit.name,
    note: input.note ?? '',
  };
}

async function insertDiscounts(db: Executor, priceRecordId: string, discounts: Discount[]) {
  if (discounts.length === 0) return;
  await db.insert(discount).values(
    discounts.map((d, position) => ({ priceRecordId, position, amount: d.amount, name: d.name || null })),
  );
}

export async function pricingOf(db: Executor, scope: CurrentMember, productId: string) {
  const [found] = await db
    .select({
      dimension: product.pricingUnitDimension,
      name: product.pricingUnitName,
      baseSize: product.baseSize,
      stockLine: product.stockLine,
    })
    .from(product)
    .where(and(eq(product.householdId, scope.householdId), eq(product.id, productId)));
  if (!found) return null;
  return {
    pricingUnit: { dimension: found.dimension, name: found.name } as Unit,
    baseSize: found.baseSize,
    stockLine: found.stockLine,
  };
}

export function createPriceRecord(db: Database, scope: CurrentMember, input: NewPriceRecord) {
  return translate(
    () =>
      db.transaction(async (tx) => {
        const pricing = await pricingOf(tx, scope, input.productId);
        if (!pricing) throw new ProductNotFoundError();
        const [created] = await tx
          .insert(priceRecord)
          .values({
            ...(await recordValues(tx, scope, pricing, input)),
            householdId: scope.householdId,
            productId: input.productId,
            recordedBy: scope.userId,
            source: 'manual',
          })
          .returning({ id: priceRecord.id });
        await insertDiscounts(tx, created!.id, input.discounts);
        return (await findPriceRecord(tx, scope, created!.id))!;
      }),
    ParentNotFoundError,
  );
}

export function replacePriceRecord(db: Database, scope: CurrentMember, id: string, input: PriceRecordInput) {
  return translate(
    () =>
      db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ productId: priceRecord.productId })
          .from(priceRecord)
          .where(and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, id)));
        if (!existing) return null;
        const pricing = (await pricingOf(tx, scope, existing.productId))!;
        await tx
          .update(priceRecord)
          .set(await recordValues(tx, scope, pricing, input, true))
          .where(and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, id)));
        await tx.delete(discount).where(eq(discount.priceRecordId, id));
        await insertDiscounts(tx, id, input.discounts);
        return findPriceRecord(tx, scope, id);
      }),
    ParentNotFoundError,
  );
}

export async function deletePriceRecord(db: Database, scope: CurrentMember, id: string) {
  const deleted = await db
    .delete(priceRecord)
    .where(and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, id)))
    .returning({ id: priceRecord.id });
  return deleted.length > 0;
}
