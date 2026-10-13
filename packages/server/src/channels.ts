import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from './db';
import { NotEmptyError, translate } from './db/errors';
import { channel } from './db/schema';
import type { CurrentMember } from './members';

const columns = { id: channel.id, name: channel.name, archivedAt: channel.archivedAt };

function toChannel({ archivedAt, ...rest }: { id: string; name: string; archivedAt: Date | null }) {
  return { ...rest, archived: archivedAt !== null };
}

export async function listChannels(db: Database, scope: CurrentMember, filter: { includeArchived: boolean }) {
  const rows = await db
    .select(columns)
    .from(channel)
    .where(
      and(eq(channel.householdId, scope.householdId), filter.includeArchived ? undefined : isNull(channel.archivedAt)),
    )
    .orderBy(asc(channel.name));
  return rows.map(toChannel);
}

export async function findChannel(db: Database, scope: CurrentMember, id: string) {
  const [found] = await db
    .select(columns)
    .from(channel)
    .where(and(eq(channel.householdId, scope.householdId), eq(channel.id, id)));
  return found ? toChannel(found) : null;
}

export function createChannel(db: Database, scope: CurrentMember, input: { name: string }) {
  return translate(async () => {
    const [created] = await db
      .insert(channel)
      .values({ householdId: scope.householdId, name: input.name })
      .returning(columns);
    return toChannel(created!);
  });
}

export function updateChannel(
  db: Database,
  scope: CurrentMember,
  id: string,
  input: { name?: string; archived?: boolean },
) {
  const { name, archived } = input;
  return translate(async () => {
    const [updated] = await db
      .update(channel)
      .set({ name, archivedAt: archived === undefined ? undefined : archived ? new Date() : null })
      .where(and(eq(channel.householdId, scope.householdId), eq(channel.id, id)))
      .returning(columns);
    return updated ? toChannel(updated) : null;
  });
}

// Fails with NotEmptyError while price records name the channel, which keeps them pointing at it; archiving hides it instead.
export function deleteChannel(db: Database, scope: CurrentMember, id: string) {
  return translate(async () => {
    const deleted = await db
      .delete(channel)
      .where(and(eq(channel.householdId, scope.householdId), eq(channel.id, id)))
      .returning({ id: channel.id });
    return deleted.length > 0;
  }, NotEmptyError);
}
