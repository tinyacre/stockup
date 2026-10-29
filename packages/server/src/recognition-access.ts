import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Database, Transaction } from './db';
import { organization, recognition } from './db/schema';
import type { CurrentMember } from './members';
import type { RecognizerConfig, RecognizerFactory, ScreenshotRecognizer } from './recognizer';

// The instance's own provider, shared by every household up to the same number of recognitions a month.
export interface InstanceRecognition {
  recognizer: RecognizerConfig;
  // Zero offers no recognition on the instance's provider.
  monthlyQuota: number;
}

// Where a household's recognitions are read with.
export type RecognitionSource = 'instance';

export interface RecognitionQuota {
  monthly: number;
  // Recognitions this month that succeeded or are still running; failed ones give their turn back.
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
}

export type RecognizerChoice =
  { recognizer: ScreenshotRecognizer } | { error: 'recognition_unavailable' | 'recognition_quota_exhausted' };

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
        inArray(recognition.status, ['succeeded', 'pending']),
        gte(recognition.createdAt, start),
        lt(recognition.createdAt, next),
      ),
    );
  return counted!.used;
}

// Decides what each household recognizes screenshots with: today the instance's provider within its monthly quota.
export function recognitionAccess(recognizers: RecognizerFactory, instance: InstanceRecognition | undefined) {
  const offered =
    instance && instance.monthlyQuota > 0
      ? { monthlyQuota: instance.monthlyQuota, recognizer: recognizers.create(instance.recognizer) }
      : undefined;

  async function quotaOf(db: Database | Transaction, monthly: number, householdId: string) {
    return { monthly, used: await usedThisMonth(db, householdId), resetsOn: localDate(currentMonth().next) };
  }

  return {
    async status(db: Database, scope: CurrentMember): Promise<RecognitionStatus> {
      if (!offered) return { available: false, source: null, quota: null };
      const quota = await quotaOf(db, offered.monthlyQuota, scope.householdId);
      return { available: quota.used < quota.monthly, source: 'instance', quota };
    },

    // Holds the household until the transaction ends, so recognitions started at the same time take the
    // quota's last turns one by one; the caller records the new recognition in the same transaction.
    async choose(tx: Transaction, scope: CurrentMember): Promise<RecognizerChoice> {
      if (!offered) return { error: 'recognition_unavailable' };
      await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, scope.householdId))
        .for('no key update');
      const quota = await quotaOf(tx, offered.monthlyQuota, scope.householdId);
      if (quota.used >= quota.monthly) return { error: 'recognition_quota_exhausted' };
      return { recognizer: offered.recognizer };
    },
  };
}

export type RecognitionAccess = ReturnType<typeof recognitionAccess>;
