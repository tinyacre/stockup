import { and, asc, count, eq } from 'drizzle-orm';
import type { Unit } from '@stockup/domain';
import type { Database } from './db';
import { category, categoryGroup, product } from './db/schema';
import type { CurrentMember } from './members';

export class NameTakenError extends Error {
  override name = 'NameTakenError';
}

export class NotEmptyError extends Error {
  override name = 'NotEmptyError';
}

// The parent a row was asked to hang under is not in the member's household.
export class ParentNotFoundError extends Error {
  override name = 'ParentNotFoundError';
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

// Drizzle wraps driver errors, so the Postgres error code sits somewhere along the cause chain.
function pgErrorCode(error: unknown): string | undefined {
  for (let e = error; e instanceof Error; e = e.cause) {
    if ('code' in e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}

// Uniqueness and parent/child integrity are enforced by the database, so concurrent requests
// cannot slip past a check made in application code.
async function translate<T>(write: () => Promise<T>, onForeignKey?: new () => Error): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === UNIQUE_VIOLATION) throw new NameTakenError();
    if (code === FOREIGN_KEY_VIOLATION && onForeignKey) throw new onForeignKey();
    throw error;
  }
}

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
      .leftJoin(product, and(eq(product.householdId, category.householdId), eq(product.categoryId, category.id)))
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
  note: product.note,
};

type ProductRow = Pick<typeof product.$inferSelect, keyof typeof productColumns>;

function toProduct({ pricingUnitDimension, pricingUnitName, ...rest }: ProductRow) {
  return { ...rest, pricingUnit: { dimension: pricingUnitDimension, name: pricingUnitName } as Unit };
}

export interface NewProduct {
  categoryId: string;
  name: string;
  pricingUnit: Unit;
  baseSize: number;
  note?: string;
}

export async function listProducts(db: Database, scope: CurrentMember, filter: { categoryId?: string }) {
  const rows = await db
    .select(productColumns)
    .from(product)
    .where(
      and(
        eq(product.householdId, scope.householdId),
        filter.categoryId === undefined ? undefined : eq(product.categoryId, filter.categoryId),
      ),
    )
    .orderBy(asc(product.name));
  return rows.map(toProduct);
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

export function updateProduct(
  db: Database,
  scope: CurrentMember,
  id: string,
  input: { name?: string; categoryId?: string; note?: string },
) {
  return translate(async () => {
    const [updated] = await db
      .update(product)
      .set(input)
      .where(and(eq(product.householdId, scope.householdId), eq(product.id, id)))
      .returning(productColumns);
    return updated ? toProduct(updated) : null;
  }, ParentNotFoundError);
}

export async function deleteProduct(db: Database, scope: CurrentMember, id: string) {
  const deleted = await db
    .delete(product)
    .where(and(eq(product.householdId, scope.householdId), eq(product.id, id)))
    .returning({ id: product.id });
  return deleted.length > 0;
}
