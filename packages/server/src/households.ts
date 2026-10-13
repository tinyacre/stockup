import type { Auth } from './auth';
import type { Database } from './db';
import { account, member, organization, promotion, user } from './db/schema';

export const HOUSEHOLD_ADMIN_ROLE = 'admin';
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

// Writes the Better Auth rows directly so the account, household and presets commit together;
// Better Auth's own sign-up is disabled and cannot join a caller's transaction.
export async function createHousehold(db: Executor, auth: Auth, input: NewHousehold) {
  const { password } = await auth.$context;
  const passwordHash = await password.hash(input.admin.password);
  const userId = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: userId,
      name: input.admin.name,
      // Members sign in by username; Better Auth still requires a unique email.
      email: `${userId}@users.stockup.invalid`,
      username: input.admin.username.toLowerCase(),
      displayUsername: input.admin.username,
      role: input.instanceAdmin ? INSTANCE_ADMIN_ROLE : 'user',
    });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
      updatedAt: now,
    });
    await tx.insert(organization).values({ id: householdId, name: input.householdName, slug: householdId, createdAt: now });
    await tx.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: householdId,
      userId,
      role: HOUSEHOLD_ADMIN_ROLE,
      createdAt: now,
    });
    await tx.insert(promotion).values(PRESET_PROMOTIONS.map((p) => ({ ...p, householdId })));
  });

  return { userId, householdId };
}
