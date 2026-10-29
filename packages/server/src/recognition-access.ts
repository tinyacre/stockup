import { and, eq, gte, lt, or, sql } from 'drizzle-orm';
import { localDate } from '@stockup/domain';
import type { Database, Transaction } from './db';
import { organization, recognition, type recognitionSources } from './db/schema';
import { HOUSEHOLD_ADMIN_ROLE } from './households';
import type { CredentialSummary, HouseholdCredentials, StoredCredential } from './household-credentials';
import type { CurrentMember } from './members';
import type { RecognizerConfig, RecognizerFactory, ScreenshotRecognizer } from './recognizer';

// The instance's own provider, shared by every household up to the same number of recognitions a month.
export interface InstanceRecognition {
  recognizer: RecognizerConfig;
  monthlyQuota: number;
}

// What a household's recognitions are read with: its own credential, or the instance's provider within the quota.
export type RecognitionSource = (typeof recognitionSources)[number];

export interface RecognitionQuota {
  monthly: number;
  // Recognitions on the instance's provider this month that produced drafts or are still running; failed ones and
  // ones that found nothing on the screenshot give their turn back, and the household's own credential never takes
  // one.
  used: number;
  // The first day of next month, as YYYY-MM-DD.
  resetsOn: string;
}

export interface RecognitionStatus {
  available: boolean;
  // Null while the household has nothing to recognize with.
  source: RecognitionSource | null;
  // Null for a source without a quota.
  quota: RecognitionQuota | null;
  householdAdmin: boolean;
  // Whether the instance lets household admins configure a credential of their own.
  householdCredentials: boolean;
  // Shown to the household admin only.
  credential: CredentialSummary | null;
}

export type RecognizerChoice =
  | { recognizer: ScreenshotRecognizer; source: RecognitionSource }
  | { error: 'recognition_unavailable' | 'recognition_quota_exhausted' | 'household_key_unavailable' };

type Refusal = Extract<RecognizerChoice, { error: unknown }>['error'];

// What a household recognizes with right now, or why it cannot; the recognizer is built only once one is needed.
type Decision = { own: StoredCredential | null; source: RecognitionSource | null; quota: RecognitionQuota | null } & (
  { refusal: Refusal } | { refusal: null; source: RecognitionSource; recognizer: () => ScreenshotRecognizer }
);

// Months follow the server's time zone, so every household's quota turns over at the same local midnight.
function currentMonth(now = new Date()) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    next: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

async function usedThisMonth(
  db: Database | Transaction,
  householdId: string,
  { start, next }: ReturnType<typeof currentMonth>,
) {
  const [counted] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(recognition)
    .where(
      and(
        eq(recognition.householdId, householdId),
        eq(recognition.source, 'instance'),
        or(
          eq(recognition.status, 'pending'),
          and(eq(recognition.status, 'succeeded'), sql`jsonb_array_length(${recognition.result} -> 'items') > 0`),
        ),
        gte(recognition.createdAt, start),
        lt(recognition.createdAt, next),
      ),
    );
  return counted!.used;
}

// Decides what each household recognizes screenshots with: its own credential when it has one, which never falls
// back to the instance's provider, and otherwise the instance's provider within its monthly quota. Without
// `credentials` (no encryption key) households' own credentials are left unread, so they use the quota.
export function recognitionAccess(
  instance: { recognizers: RecognizerFactory; recognition: InstanceRecognition | undefined },
  households: { recognizers: RecognizerFactory; credentials: HouseholdCredentials | undefined },
) {
  const { credentials } = households;
  const offered = instance.recognition && {
    monthlyQuota: instance.recognition.monthlyQuota,
    recognizer: instance.recognizers.create(instance.recognition.recognizer),
  };

  async function decide(db: Database | Transaction, householdId: string): Promise<Decision> {
    const own = (await credentials?.find(db, householdId)) ?? null;
    if (own) {
      const { config } = own;
      return config
        ? {
            own,
            source: 'household',
            quota: null,
            refusal: null,
            recognizer: () => households.recognizers.create(config),
          }
        : { own, source: 'household', quota: null, refusal: 'household_key_unavailable' };
    }
    if (!offered) return { own, source: null, quota: null, refusal: 'recognition_unavailable' };
    const month = currentMonth();
    const quota = {
      monthly: offered.monthlyQuota,
      used: await usedThisMonth(db, householdId, month),
      resetsOn: localDate(month.next),
    };
    return quota.used < quota.monthly
      ? { own, source: 'instance', quota, refusal: null, recognizer: () => offered.recognizer }
      : { own, source: 'instance', quota, refusal: 'recognition_quota_exhausted' };
  }

  return {
    async status(db: Database, scope: CurrentMember): Promise<RecognitionStatus> {
      const householdAdmin = scope.householdRole === HOUSEHOLD_ADMIN_ROLE;
      const { own, source, quota, refusal } = await decide(db, scope.householdId);
      return {
        available: refusal === null,
        source,
        quota,
        householdAdmin,
        householdCredentials: credentials !== undefined,
        credential: (householdAdmin && own?.summary) || null,
      };
    },

    // Holds the household until the transaction ends, so recognitions started at the same time take the
    // quota's last turns one by one; the caller records the new recognition in the same transaction.
    async choose(tx: Transaction, scope: CurrentMember): Promise<RecognizerChoice> {
      await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, scope.householdId))
        .for('no key update');
      const decision = await decide(tx, scope.householdId);
      if (decision.refusal) return { error: decision.refusal };
      return { recognizer: decision.recognizer(), source: decision.source };
    },
  };
}

export type RecognitionAccess = ReturnType<typeof recognitionAccess>;
