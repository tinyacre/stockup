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

// Why a screenshot uploaded now fails at once: nothing to recognize with, the quota used up, or a household key the
// server cannot read.
export const recognitionRefusals = [
  'recognition_unavailable',
  'recognition_quota_exhausted',
  'household_key_unavailable',
] as const;
export type RecognitionRefusal = (typeof recognitionRefusals)[number];

export interface RecognitionStatus {
  available: boolean;
  // Null while a screenshot uploaded now would be recognized.
  refusal: RecognitionRefusal | null;
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

// What a recognition fails with when its call to the provider does: the household admin has to fix a key of the
// household's own, so its failure is told apart.
type CallFailure = 'household_key_unavailable' | 'recognition_failed';

export type RecognizerChoice =
  | { recognizer: ScreenshotRecognizer; source: RecognitionSource; callFailure: CallFailure }
  | { error: RecognitionRefusal };

// What a household recognizes with right now, or why it cannot; the recognizer is built only once one is needed.
type Decision = { own: StoredCredential | null; source: RecognitionSource | null; quota: RecognitionQuota | null } & (
  | { refusal: RecognitionRefusal }
  | { source: RecognitionSource; callFailure: CallFailure; recognizer: () => ScreenshotRecognizer }
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

  // `lock` holds the household until the transaction ends, so recognitions started at the same time take the quota's
  // last turns one by one; a household with its own credential takes no turns, so it is never held.
  async function decide(db: Database | Transaction, householdId: string, { lock = false } = {}): Promise<Decision> {
    const own = (await credentials?.find(db, householdId)) ?? null;
    if (own) {
      const base = { own, source: 'household' as const, quota: null };
      const { config } = own;
      return config
        ? { ...base, callFailure: 'household_key_unavailable', recognizer: () => households.recognizers.create(config) }
        : { ...base, refusal: 'household_key_unavailable' };
    }
    if (!offered) return { own, source: null, quota: null, refusal: 'recognition_unavailable' };
    if (lock) {
      await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, householdId))
        .for('no key update');
    }
    const month = currentMonth();
    const quota = {
      monthly: offered.monthlyQuota,
      used: await usedThisMonth(db, householdId, month),
      resetsOn: localDate(month.next),
    };
    const base = { own, source: 'instance' as const, quota };
    return quota.used < quota.monthly
      ? { ...base, callFailure: 'recognition_failed', recognizer: () => offered.recognizer }
      : { ...base, refusal: 'recognition_quota_exhausted' };
  }

  return {
    async status(db: Database, scope: CurrentMember): Promise<RecognitionStatus> {
      const householdAdmin = scope.householdRole === HOUSEHOLD_ADMIN_ROLE;
      const decision = await decide(db, scope.householdId);
      return {
        available: 'recognizer' in decision,
        refusal: 'recognizer' in decision ? null : decision.refusal,
        source: decision.source,
        quota: decision.quota,
        householdAdmin,
        householdCredentials: credentials !== undefined,
        credential: (householdAdmin && decision.own?.summary) || null,
      };
    },

    // The caller records the new recognition in the same transaction, which keeps the household held until then.
    async choose(tx: Transaction, scope: CurrentMember): Promise<RecognizerChoice> {
      const decision = await decide(tx, scope.householdId, { lock: true });
      if (!('recognizer' in decision)) return { error: decision.refusal };
      return { recognizer: decision.recognizer(), source: decision.source, callFailure: decision.callFailure };
    },
  };
}

export type RecognitionAccess = ReturnType<typeof recognitionAccess>;
