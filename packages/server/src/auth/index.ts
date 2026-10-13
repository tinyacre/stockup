import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, username } from 'better-auth/plugins';
import type { Database } from '../db';
import * as schema from '../db/schema';

export interface AuthOptions {
  db: Database;
  secret: string;
  baseURL?: string;
}

export function createAuth({ db, secret, baseURL }: AuthOptions) {
  return betterAuth({
    baseURL,
    basePath: '/api/auth',
    secret,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    // Accounts are created by onboarding and (later) invitations, never by open sign-up.
    emailAndPassword: { enabled: true, disableSignUp: true },
    user: {
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'user', input: false },
      },
    },
    plugins: [
      username(),
      // Households are created by StockUp's own services, which also enforce one household per member.
      organization({ allowUserToCreateOrganization: false }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
