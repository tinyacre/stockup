import type { Auth } from './auth';
import type { EmailCodes } from './email-codes';
import { createHousehold, type NewAccount } from './households';

// The account exists only once its email is verified: the code is redeemed in the transaction that creates
// the account and its household, whose admin the new member becomes without administering the instance.
export function signUp(auth: Auth, codes: EmailCodes, input: NewAccount & { email: string; code: string }) {
  const { code, ...account } = input;
  return codes.redeem(account.email, 'register', code, (tx) =>
    createHousehold(tx, auth, { householdName: `${account.username} 的家`, admin: account, instanceAdmin: false }),
  );
}
