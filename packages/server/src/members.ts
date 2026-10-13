import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { Auth } from './auth';
import type { Database } from './db';
import { member, organization } from './db/schema';
import { INSTANCE_ADMIN_ROLE } from './households';

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
  isInstanceAdmin: boolean;
}

export type MemberEnv = { Variables: { member: CurrentMember } };

// The household is looked up on every request rather than cached in the session,
// so removing someone from a household takes effect immediately.
export function requireMember(auth: Auth, db: Database) {
  return createMiddleware<MemberEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'unauthenticated' }, 401);

    const [membership] = await db
      .select({
        memberId: member.id,
        householdId: member.organizationId,
        householdRole: member.role,
        householdName: organization.name,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, session.user.id));
    if (!membership) return c.json({ error: 'no_household' }, 403);

    c.set('member', {
      ...membership,
      userId: session.user.id,
      username: session.user.username ?? '',
      name: session.user.name,
      isInstanceAdmin: session.user.role === INSTANCE_ADMIN_ROLE,
    });
    await next();
  });
}
