import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  calculatePrice,
  convert,
  judge,
  matchPromotion,
  type Discount,
  type Size,
  type Unit,
  type Verdict,
} from '@stockup/domain';
import type { Database } from './db';
import { ParentNotFoundError, translate } from './db/errors';
import { channel, discount, evidence, priceRecord, priceRecordSources, product, promotion, user } from './db/schema';
import { evidenceOfRecords, removeEvidenceFiles } from './evidence';
import type { EvidenceStore } from './evidence-store';
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

async function withDetails(db: Executor, scope: CurrentMember, rows: Row[]) {
  const ids = rows.map((r) => r.id);
  const [discounts, evidenceByRecord] = await Promise.all([
    ids.length
      ? db
          .select({ priceRecordId: discount.priceRecordId, amount: discount.amount, name: discount.name })
          .from(discount)
          .where(inArray(discount.priceRecordId, ids))
          .orderBy(asc(discount.position))
      : [],
    evidenceOfRecords(db, scope, ids),
  ]);
  const byRecord = new Map<string, Discount[]>();
  for (const { priceRecordId, amount, name } of discounts) {
    byRecord.set(priceRecordId, [...(byRecord.get(priceRecordId) ?? []), name === null ? { amount } : { amount, name }]);
  }
  return rows.map((row) => ({
    ...toPriceRecord(row, byRecord.get(row.id) ?? []),
    evidence: evidenceByRecord.get(row.id) ?? [],
  }));
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
  return withDetails(db, scope, rows);
}

export async function findPriceRecord(db: Executor, scope: CurrentMember, id: string) {
  const rows = await selectRecords(db).where(
    and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, id)),
  );
  const [found] = await withDetails(db, scope, rows);
  return found ?? null;
}

export async function lowestUnitPrice(db: Database, scope: CurrentMember, productId: string) {
  const records = await listPriceRecords(db, scope, { productIds: [productId] });
  return records.length ? Math.min(...records.map((r) => r.unitPrice)) : null;
}

export interface PriceSummary {
  lowestUnitPrice: number | null;
  latestPrice: { date: string; unitPrice: number; verdict: Verdict | null } | null;
}

// The newest record is judged against the product's other records, so a record low still reads as one.
export async function summarizePrices(
  db: Database,
  scope: CurrentMember,
  products: { id: string; stockLine: number | null }[],
) {
  const byProduct = new Map<string, { date: string; unitPrice: number }[]>(products.map((p) => [p.id, []]));
  for (const r of await listPriceRecords(db, scope, { productIds: products.map((p) => p.id) })) {
    byProduct.get(r.productId)!.push(r);
  }
  return new Map<string, PriceSummary>(
    products.map(({ id, stockLine }) => {
      const [latest, ...older] = byProduct.get(id)!;
      if (!latest) return [id, { lowestUnitPrice: null, latestPrice: null }];
      const olderLowest = older.length ? Math.min(...older.map((r) => r.unitPrice)) : null;
      const { verdict } = judge({ unitPrice: latest.unitPrice, stockLine, lowestUnitPrice: olderLowest });
      return [
        id,
        {
          lowestUnitPrice: Math.min(latest.unitPrice, olderLowest ?? Infinity),
          latestPrice: { date: latest.date, unitPrice: latest.unitPrice, verdict },
        },
      ];
    }),
  );
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

// Writers lock the product so a change of pricing unit or a merge waits until the record is written.
export async function pricingOf(db: Executor, scope: CurrentMember, productId: string, { lock = false } = {}) {
  const query = db
    .select({
      dimension: product.pricingUnitDimension,
      name: product.pricingUnitName,
      baseSize: product.baseSize,
      stockLine: product.stockLine,
    })
    .from(product)
    .where(and(eq(product.householdId, scope.householdId), eq(product.id, productId)))
    .$dynamic();
  const [found] = await (lock ? query.for('share') : query);
  if (!found) return null;
  return {
    pricingUnit: { dimension: found.dimension, name: found.name } as Unit,
    baseSize: found.baseSize,
    stockLine: found.stockLine,
  };
}

// Runs inside the caller's transaction, which then holds the product's lock until it commits.
export async function insertPriceRecord(
  tx: Executor,
  scope: CurrentMember,
  input: NewPriceRecord,
  source: (typeof priceRecordSources)[number],
) {
  const pricing = await pricingOf(tx, scope, input.productId, { lock: true });
  if (!pricing) throw new ProductNotFoundError();
  const [created] = await tx
    .insert(priceRecord)
    .values({
      ...(await recordValues(tx, scope, pricing, input)),
      householdId: scope.householdId,
      productId: input.productId,
      recordedBy: scope.userId,
      source,
    })
    .returning({ id: priceRecord.id });
  await insertDiscounts(tx, created!.id, input.discounts);
  return created!.id;
}

export function createPriceRecord(
  db: Database,
  scope: CurrentMember,
  input: NewPriceRecord,
  source: (typeof priceRecordSources)[number] = 'manual',
) {
  return translate(
    () =>
      db.transaction(async (tx) => {
        const id = await insertPriceRecord(tx, scope, input, source);
        return (await findPriceRecord(tx, scope, id))!;
      }),
    ParentNotFoundError,
  );
}

export function replacePriceRecord(db: Database, scope: CurrentMember, id: string, input: PriceRecordInput) {
  return translate(
    () =>
      db.transaction(async (tx) => {
        const productIdOf = async () => {
          const [found] = await tx
            .select({ productId: priceRecord.productId })
            .from(priceRecord)
            .where(and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, id)));
          return found?.productId;
        };
        // A merge can move the record to another product while this waits for the product's lock,
        // so the record's product is read again once the lock is held.
        let productId = await productIdOf();
        let pricing;
        while (productId !== undefined) {
          pricing = await pricingOf(tx, scope, productId, { lock: true });
          const current = await productIdOf();
          if (pricing && current === productId) break;
          productId = current;
        }
        if (productId === undefined || !pricing) return null;
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

// The record's Evidence rows go with it, and their files are removed once it is gone.
export async function deletePriceRecord(db: Database, store: EvidenceStore, scope: CurrentMember, id: string) {
  const keys = await db.transaction(async (tx) => {
    const scoped = and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, id));
    // Locking the record first waits out an upload in flight, so its Evidence is listed below.
    const [found] = await tx.select({ id: priceRecord.id }).from(priceRecord).where(scoped).for('update');
    if (!found) return null;
    const pieces = await tx
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.householdId, scope.householdId), eq(evidence.priceRecordId, id)));
    await tx.delete(priceRecord).where(scoped);
    return pieces.map((p) => p.id);
  });
  if (keys === null) return false;
  await removeEvidenceFiles(store, keys);
  return true;
}
