import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './db';
import { promotion } from './db/schema';
import type { CurrentMember } from './members';

const columns = {
  id: promotion.id,
  name: promotion.name,
  startsOn: promotion.startsOn,
  endsOn: promotion.endsOn,
};

export function listPromotions(db: Database, scope: CurrentMember) {
  return db
    .select(columns)
    .from(promotion)
    .where(eq(promotion.householdId, scope.householdId))
    .orderBy(asc(promotion.startsOn), asc(promotion.name));
}

export async function findPromotion(db: Database, scope: CurrentMember, id: string) {
  const [found] = await db
    .select(columns)
    .from(promotion)
    .where(and(eq(promotion.householdId, scope.householdId), eq(promotion.id, id)));
  return found ?? null;
}
