export class NameTakenError extends Error {
  override name = 'NameTakenError';
}

export class EmailTakenError extends Error {
  override name = 'EmailTakenError';
}

export class NotEmptyError extends Error {
  override name = 'NotEmptyError';
}

// The parent a row was asked to hang under is not in the member's household.
export class ParentNotFoundError extends Error {
  override name = 'ParentNotFoundError';
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const USER_EMAIL_UNIQUE = 'user_email_unique';

// Drizzle wraps driver errors, so the Postgres error sits somewhere along the cause chain.
function pgError(error: unknown): { code: string; constraint?: string } | undefined {
  for (let e = error; e instanceof Error; e = e.cause) {
    if ('code' in e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      const constraint =
        'constraint_name' in e && typeof e.constraint_name === 'string' ? e.constraint_name : undefined;
      return { code: e.code, constraint };
    }
  }
  return undefined;
}

// Uniqueness and parent/child integrity are enforced by the database, so concurrent requests
// cannot slip past a check made in application code.
export async function translate<T>(write: () => Promise<T>, onForeignKey?: new () => Error): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const pg = pgError(error);
    if (pg?.code === UNIQUE_VIOLATION)
      throw pg.constraint === USER_EMAIL_UNIQUE ? new EmailTakenError() : new NameTakenError();
    if (pg?.code === FOREIGN_KEY_VIOLATION && onForeignKey) throw new onForeignKey();
    throw error;
  }
}
