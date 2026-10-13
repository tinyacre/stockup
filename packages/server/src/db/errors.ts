export class NameTakenError extends Error {
  override name = 'NameTakenError';
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

// Drizzle wraps driver errors, so the Postgres error code sits somewhere along the cause chain.
function pgErrorCode(error: unknown): string | undefined {
  for (let e = error; e instanceof Error; e = e.cause) {
    if ('code' in e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}

// Uniqueness and parent/child integrity are enforced by the database, so concurrent requests
// cannot slip past a check made in application code.
export async function translate<T>(write: () => Promise<T>, onForeignKey?: new () => Error): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === UNIQUE_VIOLATION) throw new NameTakenError();
    if (code === FOREIGN_KEY_VIOLATION && onForeignKey) throw new onForeignKey();
    throw error;
  }
}
