import { eq } from 'drizzle-orm';
import type { Database, Transaction } from './db';
import { householdRecognitionCredential, user } from './db/schema';
import type { CurrentMember } from './members';
import type { RecognitionProvider, RecognizerConfig, RecognizerFactory, RecognizerProblem } from './recognizer';
import type { SecretBox } from './secret-box';

// What a household admin may see of the household's credential: never the key, only its last four characters.
export interface CredentialSummary {
  provider: RecognitionProvider;
  baseURL: string | null;
  model: string | null;
  apiKeyLastFour: string;
  updatedAt: Date;
  updatedBy: { id: string; name: string } | null;
}

export class CredentialRejectedError extends Error {
  override name = 'CredentialRejectedError';
  constructor(readonly problem: RecognizerProblem) {
    super(`The provider refused the configuration: ${problem}`);
  }
}

// The household's credential, and the configuration to recognize with: null when the key was sealed with another
// encryption key than the server now has, so it cannot be read back.
export interface StoredCredential {
  summary: CredentialSummary;
  config: RecognizerConfig | null;
}

const summaryColumns = {
  provider: householdRecognitionCredential.provider,
  baseURL: householdRecognitionCredential.baseUrl,
  model: householdRecognitionCredential.model,
  apiKeyLastFour: householdRecognitionCredential.apiKeyLastFour,
  updatedAt: householdRecognitionCredential.updatedAt,
};

// Requires the factory households' recognitions use, so a configuration is checked the way it will be called.
export function householdCredentials(db: Database, box: SecretBox, recognizers: RecognizerFactory) {
  return {
    // Null when the household has none. Opening the key is the only way to tell whether the server can still use
    // it: authenticated encryption reveals a key sealed with another encryption key only by failing to open it.
    async find(tx: Database | Transaction, householdId: string): Promise<StoredCredential | null> {
      const [found] = await tx
        .select({
          ...summaryColumns,
          sealedApiKey: householdRecognitionCredential.sealedApiKey,
          updatedById: user.id,
          updatedByName: user.name,
        })
        .from(householdRecognitionCredential)
        .leftJoin(user, eq(user.id, householdRecognitionCredential.updatedBy))
        .where(eq(householdRecognitionCredential.householdId, householdId));
      if (!found) return null;
      const { sealedApiKey, updatedById, updatedByName, ...summary } = found;
      const { provider, baseURL, model } = summary;
      const apiKey = box.open(sealedApiKey, householdId);
      return {
        summary: { ...summary, updatedBy: updatedById ? { id: updatedById, name: updatedByName! } : null },
        config: apiKey === null ? null : { provider, apiKey, baseURL, model },
      };
    },

    // Calls the provider with the configuration first, so a key that does not work is never saved.
    async save(scope: CurrentMember, input: RecognizerConfig): Promise<CredentialSummary> {
      const validation = await recognizers.validate(input);
      if (!validation.ok) {
        console.warn(
          `Household ${scope.householdId}'s ${input.provider} credential was refused (${validation.problem}): ${validation.message}`,
        );
        throw new CredentialRejectedError(validation.problem);
      }
      const values = {
        provider: input.provider,
        sealedApiKey: box.seal(input.apiKey, scope.householdId),
        apiKeyLastFour: input.apiKey.slice(-4),
        baseUrl: input.baseURL,
        model: input.model,
        updatedAt: new Date(),
        updatedBy: scope.userId,
      };
      const [saved] = await db
        .insert(householdRecognitionCredential)
        .values({ householdId: scope.householdId, ...values })
        .onConflictDoUpdate({ target: householdRecognitionCredential.householdId, set: values })
        .returning(summaryColumns);
      return { ...saved!, updatedBy: { id: scope.userId, name: scope.name } };
    },

    async remove(scope: CurrentMember) {
      await db
        .delete(householdRecognitionCredential)
        .where(eq(householdRecognitionCredential.householdId, scope.householdId));
    },
  };
}

export type HouseholdCredentials = ReturnType<typeof householdCredentials>;
