import type { Context } from 'hono';
import { InvitationNotFoundError, InvitationUnusableError } from '../invitations';

export const unusableInvitationCode = {
  accepted: 'invitation_used',
  revoked: 'invitation_revoked',
  expired: 'invitation_expired',
} as const;

// Shared by the invitation routes and the join code sender, which refuse a link the same way.
export function respondToInvitationError(c: Context, error: unknown) {
  if (error instanceof InvitationNotFoundError) return c.json({ error: 'not_found' }, 404);
  if (error instanceof InvitationUnusableError) return c.json({ error: unusableInvitationCode[error.reason] }, 410);
  throw error;
}
