import { sql } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Database } from './db';
import { user } from './db/schema';
import { createHousehold, type NewAccount } from './households';

export class AlreadySetUpError extends Error {
  constructor() {
    super('the instance already has members');
  }
}

export async function needsSetup(db: Pick<Database, 'select'>) {
  const [existing] = await db.select({ id: user.id }).from(user).limit(1);
  return !existing;
}

// The founder becomes both the instance admin and the admin of the first household.
export function setUpInstance(db: Database, auth: Auth, input: { householdName: string; admin: NewAccount }) {
  return db.transaction(async (tx) => {
    // Serialises concurrent founders so exactly one of them sees an empty instance.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stockup.onboarding'))`);
    if (!(await needsSetup(tx))) throw new AlreadySetUpError();
    return createHousehold(tx, auth, { ...input, instanceAdmin: true });
  });
}
