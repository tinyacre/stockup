import { and, desc, eq } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Database } from './db';
import { translate } from './db/errors';
import { invitation, organization, user } from './db/schema';
import { hashPassword, HOUSEHOLD_MEMBER_ROLE, insertMember, type NewAccount } from './households';
import type { CurrentMember } from './members';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type UnusableReason = Exclude<InvitationStatus, 'pending'>;

export class InvitationNotFoundError extends Error {
  override name = 'InvitationNotFoundError';
}

export class InvitationUnusableError extends Error {
  override name = 'InvitationUnusableError';
  constructor(readonly reason: UnusableReason) {
    super(`the invitation is ${reason}`);
  }
}

// Stored in Better Auth's invitation table with its status values; StockUp calls a canceled invitation revoked.
const STORED_PENDING = 'pending';
const STORED_ACCEPTED = 'accepted';
const STORED_CANCELED = 'canceled';

// Better Auth's invitations are addressed to an email; StockUp's are links handed to whoever should join.
const LINK_ADDRESS = 'link@invitations.stockup.invalid';

const DAY_MS = 86_400_000;

function statusOf(row: { status: string; expiresAt: Date }, now = new Date()): InvitationStatus {
  if (row.status === STORED_ACCEPTED) return 'accepted';
  if (row.status === STORED_CANCELED) return 'revoked';
  return row.expiresAt <= now ? 'expired' : 'pending';
}

const columns = {
  id: invitation.id,
  status: invitation.status,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
  inviterId: user.id,
  inviterName: user.name,
};

interface InvitationRow {
  id: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
  inviterName: string;
}

function toInvitation({ inviterId, inviterName, ...row }: InvitationRow) {
  return { ...row, status: statusOf(row), invitedBy: { id: inviterId, name: inviterName } };
}

export async function listInvitations(db: Database, scope: CurrentMember) {
  const rows = await db
    .select(columns)
    .from(invitation)
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.organizationId, scope.householdId))
    .orderBy(desc(invitation.createdAt));
  return rows.map(toInvitation);
}

export async function createInvitation(db: Database, scope: CurrentMember, input: { expiresInDays: number }) {
  const [created] = await db
    .insert(invitation)
    .values({
      id: crypto.randomUUID(),
      organizationId: scope.householdId,
      email: LINK_ADDRESS,
      role: HOUSEHOLD_MEMBER_ROLE,
      status: STORED_PENDING,
      expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
      inviterId: scope.userId,
    })
    .returning({
      id: invitation.id,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    });
  return toInvitation({ ...created!, inviterId: scope.userId, inviterName: scope.name });
}

// Revoking an already revoked or expired invitation succeeds; an accepted one has done its work and stays accepted.
export async function revokeInvitation(db: Database, scope: CurrentMember, id: string) {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select(columns)
      .from(invitation)
      .innerJoin(user, eq(user.id, invitation.inviterId))
      .where(and(eq(invitation.organizationId, scope.householdId), eq(invitation.id, id)))
      .for('update', { of: invitation });
    if (!found) throw new InvitationNotFoundError();
    if (found.status === STORED_ACCEPTED) throw new InvitationUnusableError('accepted');
    await tx.update(invitation).set({ status: STORED_CANCELED }).where(eq(invitation.id, id));
    return toInvitation({ ...found, status: STORED_CANCELED });
  });
}

// Anyone holding the link may see which household it leads to, as long as it can still be used.
export async function describeInvitation(db: Database, id: string) {
  const [found] = await db
    .select({
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      householdName: organization.name,
      invitedBy: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, id));
  if (!found) throw new InvitationNotFoundError();
  const status = statusOf(found);
  if (status !== 'pending') throw new InvitationUnusableError(status);
  return { householdName: found.householdName, invitedBy: found.invitedBy };
}

// Every invitee gets a new account, so nobody who already belongs to a household can use one to switch.
// Fails with NameTakenError when the username is in use.
export async function acceptInvitation(db: Database, auth: Auth, id: string, account: NewAccount) {
  const passwordHash = await hashPassword(auth, account.password);
  return translate(() =>
    db.transaction(async (tx) => {
      // The row lock lets exactly one of several simultaneous invitees through.
      const [found] = await tx
        .select({
          householdId: invitation.organizationId,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .where(eq(invitation.id, id))
        .for('update');
      if (!found) throw new InvitationNotFoundError();
      const status = statusOf(found);
      if (status !== 'pending') throw new InvitationUnusableError(status);

      const userId = await insertMember(tx, {
        account,
        passwordHash,
        householdId: found.householdId,
        role: found.role ?? HOUSEHOLD_MEMBER_ROLE,
      });
      await tx.update(invitation).set({ status: STORED_ACCEPTED }).where(eq(invitation.id, id));
      return { userId, householdId: found.householdId };
    }),
  );
}
