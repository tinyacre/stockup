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

// Null stands for the provider's own endpoint and default model.
export interface CredentialInput {
  provider: RecognitionProvider;
  apiKey: string;
  baseURL: string | null;
  model: string | null;
}

export class CredentialRejectedError extends Error {
  override name = 'CredentialRejectedError';
  constructor(readonly problem: RecognizerProblem) {
    super(`The provider refused the configuration: ${problem}`);
  }
}

// A credential sealed with another encryption key than the server now has, so the key cannot be read back.
export const unreadable = Symbol('unreadable');

function configOf({ provider, apiKey, baseURL, model }: CredentialInput): RecognizerConfig {
  return {
    provider,
    apiKey,
    ...(baseURL !== null && { baseURL }),
    ...(model !== null && { model }),
    publicEndpointOnly: true,
  };
}

export function householdCredentials(db: Database, box: SecretBox, recognizers: RecognizerFactory) {
  async function load(householdId: string) {
    const [found] = await db
      .select({
        sealedApiKey: householdRecognitionCredential.sealedApiKey,
        provider: householdRecognitionCredential.provider,
        baseURL: householdRecognitionCredential.baseUrl,
        model: householdRecognitionCredential.model,
        apiKeyLastFour: householdRecognitionCredential.apiKeyLastFour,
        updatedAt: householdRecognitionCredential.updatedAt,
        updatedById: user.id,
        updatedByName: user.name,
      })
      .from(householdRecognitionCredential)
      .leftJoin(user, eq(user.id, householdRecognitionCredential.updatedBy))
      .where(eq(householdRecognitionCredential.householdId, householdId));
    if (!found) return null;
    const { sealedApiKey, updatedById, updatedByName, ...rest } = found;
    const summary: CredentialSummary = {
      ...rest,
      updatedBy: updatedById ? { id: updatedById, name: updatedByName! } : null,
    };
    return { summary, sealedApiKey };
  }

  return {
    // The household's credential and whether the server can still use it; null when it has none. Opening the key
    // is the only way to tell: authenticated encryption reveals a key sealed with another encryption key only by
    // failing to open it.
    async find(householdId: string): Promise<{ summary: CredentialSummary; readable: boolean } | null> {
      const found = await load(householdId);
      if (!found) return null;
      return { summary: found.summary, readable: box.open(found.sealedApiKey, householdId) !== null };
    },

    // The configuration to recognize with, or `unreadable` when it was sealed with another encryption key.
    async config(
      tx: Database | Transaction,
      householdId: string,
    ): Promise<RecognizerConfig | typeof unreadable | null> {
      const [found] = await tx
        .select()
        .from(householdRecognitionCredential)
        .where(eq(householdRecognitionCredential.householdId, householdId));
      if (!found) return null;
      const apiKey = box.open(found.sealedApiKey, householdId);
      if (apiKey === null) return unreadable;
      return configOf({ provider: found.provider, apiKey, baseURL: found.baseUrl, model: found.model });
    },

    // Calls the provider with the configuration first, so a key that does not work is never saved.
    async save(scope: CurrentMember, input: CredentialInput): Promise<CredentialSummary> {
      const validation = await recognizers.validate(configOf(input));
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
      await db
        .insert(householdRecognitionCredential)
        .values({ householdId: scope.householdId, ...values })
        .onConflictDoUpdate({ target: householdRecognitionCredential.householdId, set: values });
      return (await load(scope.householdId))!.summary;
    },

    async remove(scope: CurrentMember) {
      await db
        .delete(householdRecognitionCredential)
        .where(eq(householdRecognitionCredential.householdId, scope.householdId));
    },
  };
}

export type HouseholdCredentials = ReturnType<typeof householdCredentials>;
