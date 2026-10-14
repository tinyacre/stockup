import { count, desc, eq } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Database } from './db';
import { translate } from './db/errors';
import { account, member, organization, promotion, user } from './db/schema';

export const HOUSEHOLD_ADMIN_ROLE = 'admin';
export const HOUSEHOLD_MEMBER_ROLE = 'member';
export const INSTANCE_ADMIN_ROLE = 'admin';

// Default ranges for the promotions every household starts with; households adjust them afterwards.
export const PRESET_PROMOTIONS = [
  { name: '年货节', startsOn: '01-05', endsOn: '01-25' },
  { name: '38 节', startsOn: '03-01', endsOn: '03-08' },
  { name: '618', startsOn: '05-31', endsOn: '06-20' },
  { name: '双 11', startsOn: '10-20', endsOn: '11-11' },
  { name: '双 12', startsOn: '12-01', endsOn: '12-12' },
] as const;

export interface NewAccount {
  username: string;
  password: string;
  name: string;
}

export interface NewHousehold {
  householdName: string;
  admin: NewAccount;
  instanceAdmin?: boolean;
}

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// Hashing is slow, so callers hash before opening the transaction that holds their locks.
export async function hashPassword(auth: Auth, plain: string) {
  const { password } = await auth.$context;
  return password.hash(plain);
}

// Writes the Better Auth rows directly so the account commits together with the caller's other writes;
// Better Auth's own sign-up is disabled and cannot join a caller's transaction.
export async function insertMember(
  db: Executor,
  input: { account: NewAccount; passwordHash: string; householdId: string; role: string; instanceAdmin?: boolean },
) {
  const userId = crypto.randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: userId,
      name: input.account.name,
      // Members sign in by username; Better Auth still requires a unique email.
      email: `${userId}@users.stockup.invalid`,
      username: input.account.username.toLowerCase(),
      displayUsername: input.account.username,
      role: input.instanceAdmin ? INSTANCE_ADMIN_ROLE : 'user',
    });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: input.passwordHash,
      updatedAt: now,
    });
    await tx.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: input.householdId,
      userId,
      role: input.role,
      createdAt: now,
    });
  });

  return userId;
}

// Fails with NameTakenError when the admin's username is in use.
export async function createHousehold(db: Executor, auth: Auth, input: NewHousehold) {
  const householdId = crypto.randomUUID();
  const passwordHash = await hashPassword(auth, input.admin.password);
  return translate(() =>
    db.transaction(async (tx) => {
      await tx
        .insert(organization)
        .values({ id: householdId, name: input.householdName, slug: householdId, createdAt: new Date() });
      await tx.insert(promotion).values(PRESET_PROMOTIONS.map((p) => ({ ...p, householdId })));
      const userId = await insertMember(tx, {
        account: input.admin,
        passwordHash,
        householdId,
        role: HOUSEHOLD_ADMIN_ROLE,
        instanceAdmin: input.instanceAdmin,
      });
      return { userId, householdId };
    }),
  );
}

export async function listHouseholds(db: Database) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      memberCount: count(member.id),
      createdAt: organization.createdAt,
    })
    .from(organization)
    .leftJoin(member, eq(member.organizationId, organization.id))
    .groupBy(organization.id)
    .orderBy(desc(organization.createdAt));
}
