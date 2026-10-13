import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './db';
import { translate } from './db/errors';
import { promotion } from './db/schema';
import type { CurrentMember } from './members';

export interface PromotionInput {
  name: string;
  startsOn: string;
  endsOn: string;
}

type Executor = Pick<Database, 'select'>;

const columns = {
  id: promotion.id,
  name: promotion.name,
  startsOn: promotion.startsOn,
  endsOn: promotion.endsOn,
};

export function listPromotions(db: Executor, scope: CurrentMember) {
  return db
    .select(columns)
    .from(promotion)
    .where(eq(promotion.householdId, scope.householdId))
    .orderBy(asc(promotion.startsOn), asc(promotion.name));
}

export async function findPromotion(db: Executor, scope: CurrentMember, id: string) {
  const [found] = await db
    .select(columns)
    .from(promotion)
    .where(and(eq(promotion.householdId, scope.householdId), eq(promotion.id, id)));
  return found ?? null;
}

export function createPromotion(db: Database, scope: CurrentMember, input: PromotionInput) {
  return translate(async () => {
    const [created] = await db
      .insert(promotion)
      .values({ ...input, householdId: scope.householdId })
      .returning(columns);
    return created!;
  });
}

// Records keep the Promotion they were tagged with, so a new range only affects records written afterwards.
export function updatePromotion(db: Database, scope: CurrentMember, id: string, input: Partial<PromotionInput>) {
  const { name, startsOn, endsOn } = input;
  return translate(async () => {
    const [updated] = await db
      .update(promotion)
      .set({ name, startsOn, endsOn })
      .where(and(eq(promotion.householdId, scope.householdId), eq(promotion.id, id)))
      .returning(columns);
    return updated ?? null;
  });
}
