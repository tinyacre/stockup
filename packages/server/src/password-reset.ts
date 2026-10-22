import { and, eq } from 'drizzle-orm';
import type { Auth } from './auth';
import { account, session, user } from './db/schema';
import { EmailCodeInvalidError, type EmailCodes } from './email-codes';
import { hashPassword } from './households';

export interface PasswordReset {
  email: string;
  code: string;
  newPassword: string;
}

// Signing every session out is the point of a reset: whoever knew the old password loses access with it.
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
  });
}
