import { and, eq } from 'drizzle-orm';
import type { Auth } from './auth';
import { account, oauthAccessToken, oauthConsent, oauthRefreshToken, session, user } from './db/schema';
import { EmailCodeInvalidError, type EmailCodes } from './email-codes';
import { hashPassword } from './households';

export interface PasswordReset {
  email: string;
  code: string;
  newPassword: string;
}

// Signing every session out and revoking every MCP client is the point of a reset: whoever knew the old password
// loses access with it, including through a client they authorized while signed in as the member.
export async function resetPassword(auth: Auth, codes: EmailCodes, { email, code, newPassword }: PasswordReset) {
  const passwordHash = await hashPassword(auth, newPassword);
  await codes.redeem(email, 'password-reset', code, async (tx) => {
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    // Reset codes are mailed only to registered addresses, so this is an account removed since its code was sent.
    if (!owner) throw new EmailCodeInvalidError('invalid');
    await tx
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential')));
    await tx.delete(session).where(eq(session.userId, owner.id));
    // Access tokens are JWTs checked against the consent on each request, so deleting it is what rejects them.
    await tx.delete(oauthConsent).where(eq(oauthConsent.userId, owner.id));
    await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, owner.id));
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, owner.id));
  });
}
