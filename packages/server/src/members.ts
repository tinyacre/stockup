import { and, asc, eq, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { Auth } from './auth';
import type { Database } from './db';
import { translate } from './db/errors';
import { member, organization, session, user } from './db/schema';
import type { EmailCodes } from './email-codes';
import { HOUSEHOLD_ADMIN_ROLE, HOUSEHOLD_MEMBER_ROLE, INSTANCE_ADMIN_ROLE, isPlaceholderEmail } from './households';

// The member a request acts as. Household-scoped services take it instead of a household ID,
// so callers can only ever reach their own household's data.
export interface CurrentMember {
  userId: string;
  memberId: string;
  householdId: string;
  householdName: string;
  householdRole: string;
  username: string;
  name: string;
  // Null for an account without a verified address.
  email: string | null;
  theme: string;
  isInstanceAdmin: boolean;
}

export type MemberEnv = { Variables: { member: CurrentMember } };

// The household is looked up on every request rather than cached in the session or access token,
// so removing someone from a household takes effect immediately.
export async function findCurrentMember(db: Database, userId: string): Promise<CurrentMember | null> {
  const [found] = await db
    .select({
      userId: user.id,
      memberId: member.id,
      householdId: member.organizationId,
      householdRole: member.role,
      householdName: organization.name,
      username: user.username,
      name: user.name,
      email: user.email,
      theme: user.theme,
      role: user.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.userId, userId));
  if (!found) return null;
  const { username, email, role, ...membership } = found;
  return {
    ...membership,
    username: username ?? '',
    email: isPlaceholderEmail(email) ? null : email,
    isInstanceAdmin: role === INSTANCE_ADMIN_ROLE,
  };
}

export function requireMember(auth: Auth, db: Database, options: { householdAdmin?: boolean } = {}) {
  return createMiddleware<MemberEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'unauthenticated' }, 401);

    const current = await findCurrentMember(db, session.user.id);
    if (!current) return c.json({ error: 'no_household' }, 403);
    if (options.householdAdmin && current.householdRole !== HOUSEHOLD_ADMIN_ROLE) {
      return c.json({ error: 'forbidden' }, 403);
    }

    c.set('member', current);
    await next();
  });
}

export type SessionEnv = { Variables: { userId: string } };

// For what belongs to the account rather than the household, which stays reachable after leaving it.
export function requireSession(auth: Auth) {
  return createMiddleware<SessionEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'unauthenticated' }, 401);
    c.set('userId', session.user.id);
    await next();
  });
}

// Administering the instance is independent of belonging to a household, so a household admin
// who removes the instance admin leaves the instance still administrable.
export function requireInstanceAdmin(auth: Auth) {
  return createMiddleware(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'unauthenticated' }, 401);
    if (session.user.role !== INSTANCE_ADMIN_ROLE) return c.json({ error: 'forbidden' }, 403);
    await next();
  });
}

export class MemberNotFoundError extends Error {
  override name = 'MemberNotFoundError';
}

// The acting member stopped being the household admin after the request was authorised,
// as when two handovers race.
export class NotHouseholdAdminError extends Error {
  override name = 'NotHouseholdAdminError';
}

export class OwnMembershipError extends Error {
  override name = 'OwnMembershipError';
}

export async function listMembers(db: Database, scope: CurrentMember) {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.displayUsername,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, scope.householdId))
    .orderBy(sql`${member.role} = ${HOUSEHOLD_ADMIN_ROLE} desc`, asc(member.createdAt), asc(user.id));
  return rows.map((row) => ({
    ...row,
    username: row.username ?? '',
    role: row.role === HOUSEHOLD_ADMIN_ROLE ? ('admin' as const) : ('member' as const),
  }));
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// Locks the acting admin's membership so removals and handovers by the same household queue up
// behind one another, and each sees the roles the previous one left.
async function lockAdmin(tx: Transaction, scope: CurrentMember) {
  const [own] = await tx.select({ role: member.role }).from(member).where(eq(member.id, scope.memberId)).for('update');
  if (own?.role !== HOUSEHOLD_ADMIN_ROLE) throw new NotHouseholdAdminError();
}

function targetIn(scope: CurrentMember, userId: string) {
  return and(eq(member.organizationId, scope.householdId), eq(member.userId, userId));
}

// The account stays, so price records keep showing who entered them; its sessions end at once.
export async function removeMember(db: Database, scope: CurrentMember, userId: string) {
  if (userId === scope.userId) throw new OwnMembershipError();
  await db.transaction(async (tx) => {
    await lockAdmin(tx, scope);
    const removed = await tx.delete(member).where(targetIn(scope, userId)).returning({ id: member.id });
    if (removed.length === 0) throw new MemberNotFoundError();
    await tx.delete(session).where(eq(session.userId, userId));
  });
}

export async function makeHouseholdAdmin(db: Database, scope: CurrentMember, userId: string) {
  if (userId === scope.userId) throw new OwnMembershipError();
  await db.transaction(async (tx) => {
    await lockAdmin(tx, scope);
    const promoted = await tx
      .update(member)
      .set({ role: HOUSEHOLD_ADMIN_ROLE })
      .where(targetIn(scope, userId))
      .returning({ id: member.id });
    if (promoted.length === 0) throw new MemberNotFoundError();
    await tx.update(member).set({ role: HOUSEHOLD_MEMBER_ROLE }).where(eq(member.id, scope.memberId));
  });
}

export async function updateTheme(db: Database, userId: string, theme: string) {
  await db.update(user).set({ theme }).where(eq(user.id, userId));
}

// Fails with EmailTakenError when another account has the address, which is only revealed to whoever holds its code.
export async function changeEmail(codes: EmailCodes, userId: string, email: string, code: string) {
  await translate(() =>
    codes.redeem(email, 'change-email', code, async (tx) => {
      await tx.update(user).set({ email, emailVerified: true }).where(eq(user.id, userId));
    }),
  );
}
