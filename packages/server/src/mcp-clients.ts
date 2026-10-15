import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './db';
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from './db/schema';

const grantOf = (userId: string, clientId: string) =>
  and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId));

export async function listMcpClients(db: Database, userId: string) {
  return db
    .select({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      uri: oauthClient.uri,
      scopes: oauthConsent.scopes,
      authorizedAt: oauthConsent.updatedAt,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.updatedAt));
}

export async function findMcpGrant(db: Database, userId: string, clientId: string) {
  const [found] = await db
    .select({ scopes: oauthConsent.scopes, createdAt: oauthConsent.createdAt })
    .from(oauthConsent)
    .where(grantOf(userId, clientId));
  return found ?? null;
}

// Removes the member's consent with the tokens issued under it, so the client has to ask the member again.
export async function revokeMcpClient(db: Database, userId: string, clientId: string) {
  return db.transaction(async (tx) => {
    const revoked = await tx.delete(oauthConsent).where(grantOf(userId, clientId)).returning({ id: oauthConsent.id });
    if (revoked.length === 0) return false;
    await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)));
    await tx
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)));
    return true;
  });
}
