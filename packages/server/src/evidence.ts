import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { evidence, priceRecord } from './db/schema';
import type { EvidenceStore } from './evidence-store';
import type { CurrentMember } from './members';

export const maxEvidenceSize = 10 * 1024 * 1024;

export class UnsupportedEvidenceTypeError extends Error {
  override name = 'UnsupportedEvidenceTypeError';
}

export class EvidenceTooLargeError extends Error {
  override name = 'EvidenceTooLargeError';
}

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
type ContentType = (typeof evidence.$inferSelect)['contentType'];

const signatures: { type: ContentType; matches(bytes: Uint8Array): boolean }[] = [
  { type: 'image/png', matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { type: 'image/jpeg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { type: 'image/gif', matches: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a') },
  { type: 'image/webp', matches: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
];

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((byte, i) => bytes[i] === byte);
}

function ascii(bytes: Uint8Array, offset: number, text: string) {
  return [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
}

// The type is read from the file's own bytes, because the one a browser declares is only a guess
// and Evidence is served back to members under it.
function contentTypeOf(bytes: Uint8Array) {
  return signatures.find((s) => s.matches(bytes))?.type ?? null;
}

const columns = {
  id: evidence.id,
  priceRecordId: evidence.priceRecordId,
  contentType: evidence.contentType,
  size: evidence.size,
  createdAt: evidence.createdAt,
};

export async function evidenceOfRecords(db: Executor, scope: CurrentMember, priceRecordIds: string[]) {
  const byRecord = new Map<string, { id: string; contentType: ContentType; size: number; createdAt: Date }[]>();
  if (priceRecordIds.length === 0) return byRecord;
  const rows = await db
    .select(columns)
    .from(evidence)
    .where(and(eq(evidence.householdId, scope.householdId), inArray(evidence.priceRecordId, priceRecordIds)))
    .orderBy(asc(evidence.sequence));
  for (const { priceRecordId, ...rest } of rows) {
    byRecord.set(priceRecordId, [...(byRecord.get(priceRecordId) ?? []), rest]);
  }
  return byRecord;
}

// Returns null when the price record is not in the member's household.
export async function addEvidence(
  db: Database,
  store: EvidenceStore,
  scope: CurrentMember,
  priceRecordId: string,
  files: Uint8Array[],
) {
  const pieces = files.map((bytes) => {
    if (bytes.length > maxEvidenceSize) throw new EvidenceTooLargeError();
    const contentType = contentTypeOf(bytes);
    if (!contentType) throw new UnsupportedEvidenceTypeError();
    return { id: crypto.randomUUID(), contentType, bytes };
  });

  // Files are written before the transaction opens, so it stays short; any failure takes them out again.
  await Promise.all(pieces.map((p) => store.put(p.id, p.bytes)));
  let added;
  try {
    added = await db.transaction(async (tx) => {
      // Holding the record keeps it from being deleted until the new rows are committed,
      // so whoever deletes it sees them and removes their files too.
      const [record] = await tx
        .select({ id: priceRecord.id })
        .from(priceRecord)
        .where(and(eq(priceRecord.householdId, scope.householdId), eq(priceRecord.id, priceRecordId)))
        .for('key share');
      if (!record) return null;
      return tx
        .insert(evidence)
        .values(
          pieces.map((p) => ({
            id: p.id,
            householdId: scope.householdId,
            priceRecordId,
            contentType: p.contentType,
            size: p.bytes.length,
            uploadedBy: scope.userId,
          })),
        )
        .returning({ ...columns, sequence: evidence.sequence });
    });
  } catch (error) {
    await removeEvidenceFiles(store, pieces.map((p) => p.id));
    throw error;
  }
  if (!added) {
    await removeEvidenceFiles(store, pieces.map((p) => p.id));
    return null;
  }
  return added
    .sort((a, b) => a.sequence - b.sequence)
    .map(({ id, contentType, size, createdAt }) => ({ id, contentType, size, createdAt }));
}

// Runs once the rows are gone, so a file that cannot be removed is only logged: the Evidence
// is already deleted as far as members can tell.
export async function removeEvidenceFiles(store: EvidenceStore, keys: string[]) {
  const results = await Promise.allSettled(keys.map((key) => store.delete(key)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') console.error(`Could not remove evidence file ${keys[i]}`, result.reason);
  });
}

export async function readEvidence(db: Database, store: EvidenceStore, scope: CurrentMember, id: string) {
  const [found] = await db
    .select({ contentType: evidence.contentType })
    .from(evidence)
    .where(and(eq(evidence.householdId, scope.householdId), eq(evidence.id, id)));
  if (!found) return null;
  const bytes = await store.get(id);
  return bytes && { contentType: found.contentType, bytes };
}

export async function deleteEvidence(db: Database, store: EvidenceStore, scope: CurrentMember, id: string) {
  const deleted = await db
    .delete(evidence)
    .where(and(eq(evidence.householdId, scope.householdId), eq(evidence.id, id)))
    .returning({ id: evidence.id });
  if (deleted.length === 0) return false;
  await removeEvidenceFiles(store, [id]);
  return true;
}
