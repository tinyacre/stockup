import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { convert, isConvertible, IncompatibleUnitsError, type Unit } from '@stockup/domain';
import { searchByName } from '@stockup/domain/search';
import type { Database } from './db';
import { category, categoryGroup, priceRecord, product, recognitionDraft } from './db/schema';
import { NotEmptyError, ParentNotFoundError, translate } from './db/errors';
import type { CurrentMember } from './members';

const groupColumns = { id: categoryGroup.id, name: categoryGroup.name };
const categoryColumns = { id: category.id, name: category.name, categoryGroupId: category.categoryGroupId };

export async function listCatalog(db: Database, scope: CurrentMember) {
  const [groups, categories] = await Promise.all([
    db
      .select(groupColumns)
      .from(categoryGroup)
      .where(eq(categoryGroup.householdId, scope.householdId))
      .orderBy(asc(categoryGroup.name)),
    db
      .select({ ...categoryColumns, productCount: count(product.id) })
      .from(category)
      .leftJoin(
        product,
        and(
          eq(product.householdId, category.householdId),
          eq(product.categoryId, category.id),
          isNull(product.archivedAt),
        ),
      )
      .where(eq(category.householdId, scope.householdId))
      .groupBy(category.id)
      .orderBy(asc(category.name)),
  ]);

  const byGroup = new Map<string, { id: string; name: string; productCount: number }[]>();
  for (const { categoryGroupId, ...c } of categories) {
    byGroup.set(categoryGroupId, [...(byGroup.get(categoryGroupId) ?? []), c]);
  }
  return groups.map((group) => ({
    ...group,
    categories: byGroup.get(group.id) ?? [],
  }));
}

export function createCategoryGroup(db: Database, scope: CurrentMember, input: { name: string }) {
  return translate(async () => {
    const [created] = await db
      .insert(categoryGroup)
      .values({ householdId: scope.householdId, name: input.name })
      .returning(groupColumns);
    return created!;
  });
}

export function updateCategoryGroup(db: Database, scope: CurrentMember, id: string, input: { name?: string }) {
  return translate(async () => {
    const [updated] = await db
      .update(categoryGroup)
      .set(input)
      .where(and(eq(categoryGroup.householdId, scope.householdId), eq(categoryGroup.id, id)))
      .returning(groupColumns);
    return updated ?? null;
  });
}

export function deleteCategoryGroup(db: Database, scope: CurrentMember, id: string) {
  return translate(async () => {
    const deleted = await db
      .delete(categoryGroup)
      .where(and(eq(categoryGroup.householdId, scope.householdId), eq(categoryGroup.id, id)))
      .returning({ id: categoryGroup.id });
    return deleted.length > 0;
  }, NotEmptyError);
}

export function createCategory(
  db: Database,
  scope: CurrentMember,
  input: { name: string; categoryGroupId: string },
) {
  return translate(async () => {
    const [created] = await db
      .insert(category)
      .values({ ...input, householdId: scope.householdId })
      .returning(categoryColumns);
    return created!;
  }, ParentNotFoundError);
}

export function updateCategory(
  db: Database,
  scope: CurrentMember,
  id: string,
  input: { name?: string; categoryGroupId?: string },
) {
  return translate(async () => {
    const [updated] = await db
      .update(category)
      .set(input)
      .where(and(eq(category.householdId, scope.householdId), eq(category.id, id)))
      .returning(categoryColumns);
    return updated ?? null;
  }, ParentNotFoundError);
}

export function deleteCategory(db: Database, scope: CurrentMember, id: string) {
  return translate(async () => {
    const deleted = await db
      .delete(category)
      .where(and(eq(category.householdId, scope.householdId), eq(category.id, id)))
      .returning({ id: category.id });
    return deleted.length > 0;
  }, NotEmptyError);
}

const productColumns = {
  id: product.id,
  name: product.name,
  categoryId: product.categoryId,
  pricingUnitDimension: product.pricingUnitDimension,
  pricingUnitName: product.pricingUnitName,
  baseSize: product.baseSize,
  stockLine: product.stockLine,
  note: product.note,
  archivedAt: product.archivedAt,
};

type ProductRow = Pick<typeof product.$inferSelect, keyof typeof productColumns>;

function toProduct({ pricingUnitDimension, pricingUnitName, archivedAt, ...rest }: ProductRow) {
  return {
    ...rest,
    pricingUnit: { dimension: pricingUnitDimension, name: pricingUnitName } as Unit,
    archived: archivedAt !== null,
  };
}

export interface NewProduct {
  categoryId: string;
  name: string;
  pricingUnit: Unit;
  baseSize: number;
  note?: string;
}

export async function listProducts(
  db: Database,
  scope: CurrentMember,
  filter: { categoryId?: string; includeArchived?: boolean },
) {
  const rows = await db
    .select(productColumns)
    .from(product)
    .where(
      and(
        eq(product.householdId, scope.householdId),
        filter.categoryId === undefined ? undefined : eq(product.categoryId, filter.categoryId),
        filter.includeArchived ? undefined : isNull(product.archivedAt),
      ),
    )
    .orderBy(asc(product.name));
  return rows.map(toProduct);
}

// Ranks with the domain package, a pure function the browser can run as well; a household's
// catalog stays small enough to load whole.
export async function searchProducts(
  db: Database,
  scope: CurrentMember,
  input: { query: string; includeArchived: boolean; limit: number },
) {
  const rows = await db
    .select(productColumns)
    .from(product)
    .where(
      and(eq(product.householdId, scope.householdId), input.includeArchived ? undefined : isNull(product.archivedAt)),
    );
  return searchByName(rows.map(toProduct), input.query).slice(0, input.limit);
}

export async function findProduct(db: Database, scope: CurrentMember, id: string) {
  const [found] = await db
    .select(productColumns)
    .from(product)
    .where(and(eq(product.householdId, scope.householdId), eq(product.id, id)));
  return found ? toProduct(found) : null;
}

export function createProduct(db: Database, scope: CurrentMember, input: NewProduct) {
  const { pricingUnit, ...rest } = input;
  return translate(async () => {
    const [created] = await db
      .insert(product)
      .values({
        ...rest,
        householdId: scope.householdId,
        pricingUnitDimension: pricingUnit.dimension,
        pricingUnitName: pricingUnit.name,
      })
      .returning(productColumns);
    return toProduct(created!);
  }, ParentNotFoundError);
}

export class SameProductError extends Error {
  override name = 'SameProductError';
}

export class MergedProductNotFoundError extends Error {
  override name = 'MergedProductNotFoundError';
}

export interface ProductChanges {
  name?: string;
  categoryId?: string;
  note?: string;
  pricingUnit?: Unit;
  // In the new pricing unit when that changes too.
  baseSize?: number;
  stockLine?: number | null;
  archived?: boolean;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// The row lock makes price records written concurrently wait, so none is stored in the old pricing unit.
async function lockProducts(tx: Transaction, scope: CurrentMember, ids: string[]) {
  const rows = await tx
    .select(productColumns)
    .from(product)
    .where(and(eq(product.householdId, scope.householdId), inArray(product.id, ids)))
    .orderBy(asc(product.id))
    .for('update');
  return rows.map(toProduct);
}

// Re-expresses the stored sizes of a product's price records; the entered amounts and units stay as typed.
async function convertSizes(tx: Transaction, scope: CurrentMember, productId: string, from: Unit, to: Unit) {
  if (from.name === to.name) return;
  await tx
    .update(priceRecord)
    .set({ sizeAmount: sql`${priceRecord.sizeAmount} * ${convert(1, from, to)}` })
    .where(and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.productId, productId)));
}

// Postgres integer columns hold amounts up to 2^31 - 1, and a stock line is at least a cent.
const maxCents = 2_000_000_000;

// A stock line is a price per Base Size, so it scales with the Base Size to keep the same threshold.
function rescaleStockLine(stockLine: number | null, ratio: number) {
  if (stockLine === null || ratio === 1) return stockLine;
  return Math.min(maxCents, Math.max(1, Math.round(stockLine * ratio)));
}

export function updateProduct(db: Database, scope: CurrentMember, id: string, input: ProductChanges) {
  const { archived, pricingUnit, baseSize, stockLine, ...rest } = input;
  return translate(
    () =>
      db.transaction(async (tx) => {
        const [current] = await lockProducts(tx, scope, [id]);
        if (!current) return null;
        const unit = pricingUnit ?? current.pricingUnit;
        if (!isConvertible(current.pricingUnit, unit)) throw new IncompatibleUnitsError(current.pricingUnit, unit);
        await convertSizes(tx, scope, id, current.pricingUnit, unit);
        const convertedBase = convert(current.baseSize, current.pricingUnit, unit);
        const newBase = baseSize ?? convertedBase;

        const [updated] = await tx
          .update(product)
          .set({
            ...rest,
            pricingUnitName: unit.name,
            baseSize: newBase,
            stockLine: stockLine === undefined ? rescaleStockLine(current.stockLine, newBase / convertedBase) : stockLine,
            // Archiving an archived product keeps the time it was first archived.
            archivedAt:
              archived === undefined ? undefined : archived ? sql`coalesce(${product.archivedAt}, now())` : null,
          })
          .where(and(eq(product.householdId, scope.householdId), eq(product.id, id)))
          .returning(productColumns);
        return toProduct(updated!);
      }),
    ParentNotFoundError,
  );
}

// Moves the merged product's price records, converted to the kept product's pricing unit, and the drafts
// that suggest it, then deletes it.
// Returns null when the kept product is not in the household.
export function mergeProducts(db: Database, scope: CurrentMember, keptId: string, mergedId: string) {
  if (keptId === mergedId) return Promise.reject(new SameProductError());
  return db.transaction(async (tx) => {
    const locked = await lockProducts(tx, scope, [keptId, mergedId]);
    const kept = locked.find((p) => p.id === keptId);
    const merged = locked.find((p) => p.id === mergedId);
    if (!kept) return null;
    if (!merged) throw new MergedProductNotFoundError();
    if (!isConvertible(merged.pricingUnit, kept.pricingUnit)) {
      throw new IncompatibleUnitsError(merged.pricingUnit, kept.pricingUnit);
    }
    await convertSizes(tx, scope, mergedId, merged.pricingUnit, kept.pricingUnit);
    await tx
      .update(priceRecord)
      .set({ productId: keptId })
      .where(and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.productId, mergedId)));
    await tx
      .update(recognitionDraft)
      .set({ productId: keptId })
      .where(and(eq(recognitionDraft.householdId, scope.householdId), eq(recognitionDraft.productId, mergedId)));
    await tx.delete(product).where(and(eq(product.householdId, scope.householdId), eq(product.id, mergedId)));
    return kept;
  });
}

export function deleteProduct(db: Database, scope: CurrentMember, id: string) {
  return translate(async () => {
    const deleted = await db
      .delete(product)
      .where(and(eq(product.householdId, scope.householdId), eq(product.id, id)))
      .returning({ id: product.id });
    return deleted.length > 0;
  }, NotEmptyError);
}
