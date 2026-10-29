import { and, eq, gte, lt, or, sql } from 'drizzle-orm';
import type { Database, Transaction } from './db';
import { organization, recognition, type recognitionSources } from './db/schema';
import { HOUSEHOLD_ADMIN_ROLE } from './households';
import { unreadable, type CredentialSummary, type HouseholdCredentials } from './household-credentials';
import type { CurrentMember } from './members';
import type { RecognizerConfig, RecognizerFactory, ScreenshotRecognizer } from './recognizer';

// The instance's own provider, shared by every household up to the same number of recognitions a month.
export interface InstanceRecognition {
  recognizer: RecognizerConfig;
  // Zero offers no recognition on the instance's provider.
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

function localDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Months follow the server's time zone, so every household's quota turns over at the same local midnight.
function currentMonth(now = new Date()) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    next: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

async function usedThisMonth(db: Database | Transaction, householdId: string) {
  const { start, next } = currentMonth();
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
  recognizers: RecognizerFactory,
  instance: InstanceRecognition | undefined,
  credentials: HouseholdCredentials | undefined,
) {
  const offered =
    instance && instance.monthlyQuota > 0
      ? { monthlyQuota: instance.monthlyQuota, recognizer: recognizers.create(instance.recognizer) }
      : undefined;

  async function quotaOf(db: Database | Transaction, monthly: number, householdId: string) {
    return { monthly, used: await usedThisMonth(db, householdId), resetsOn: localDate(currentMonth().next) };
  }

  return {
    async status(db: Database, scope: CurrentMember): Promise<RecognitionStatus> {
      const householdAdmin = scope.householdRole === HOUSEHOLD_ADMIN_ROLE;
      const own = await credentials?.find(scope.householdId);
      const shown = {
        householdAdmin,
        householdCredentials: credentials !== undefined,
        credential: (householdAdmin && own?.summary) || null,
      };
      if (own) return { available: own.readable, source: 'household', quota: null, ...shown };
      if (!offered) return { available: false, source: null, quota: null, ...shown };
      const quota = await quotaOf(db, offered.monthlyQuota, scope.householdId);
      return { available: quota.used < quota.monthly, source: 'instance', quota, ...shown };
    },

    // Holds the household until the transaction ends, so recognitions started at the same time take the
    // quota's last turns one by one; the caller records the new recognition in the same transaction.
    async choose(tx: Transaction, scope: CurrentMember): Promise<RecognizerChoice> {
      await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, scope.householdId))
        .for('no key update');
      const own = await credentials?.config(tx, scope.householdId);
      if (own === unreadable) return { error: 'household_key_unavailable' };
      if (own) return { recognizer: recognizers.create(own), source: 'household' };
      if (!offered) return { error: 'recognition_unavailable' };
      const quota = await quotaOf(tx, offered.monthlyQuota, scope.householdId);
      if (quota.used >= quota.monthly) return { error: 'recognition_quota_exhausted' };
      return { recognizer: offered.recognizer, source: 'instance' };
    },
  };
}

export type RecognitionAccess = ReturnType<typeof recognitionAccess>;
