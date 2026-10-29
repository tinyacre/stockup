import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  allocateDiscount,
  IncompatibleUnitsError,
  parseSize,
  type Discount,
  type Size,
  type Unit,
} from '@stockup/domain';
import { searchByName } from '@stockup/domain/search';
import type { Database } from './db';
import { ParentNotFoundError, translate } from './db/errors';
import { evidence, product, recognition, recognitionDraft, user } from './db/schema';
import { checkEvidenceFile, removeEvidenceFiles } from './evidence';
import type { EvidenceStore } from './evidence-store';
import type { CurrentMember } from './members';
import { findPriceRecord, insertPriceRecord, InvalidPriceError, ProductNotFoundError } from './price-records';
import type { RecognitionAccess } from './recognition-access';
import type { RecognitionResult, Screenshot, ScreenshotRecognizer } from './recognizer';

// Stores the screenshot and starts reading it in the background; the caller polls findRecognition
// for the outcome. When the household has nothing to recognize with, or has used up its quota, the recognition
// fails at once, keeping the screenshot for manual entry.
export async function startRecognition(
  db: Database,
  store: EvidenceStore,
  access: RecognitionAccess,
  scope: CurrentMember,
  bytes: Uint8Array,
) {
  const contentType = checkEvidenceFile(bytes);

  const id = crypto.randomUUID();
  await store.put(id, bytes);
  let choice;
  try {
    choice = await db.transaction(async (tx) => {
      const chosen = await access.choose(tx, scope);
      const now = new Date();
      await tx.insert(recognition).values({
        id,
        householdId: scope.householdId,
        requestedBy: scope.userId,
        screenshotContentType: contentType,
        screenshotSize: bytes.length,
        // The quota counts months by the server's clock, so the recognition is dated by it too.
        createdAt: now,
        ...('recognizer' in chosen
          ? { status: 'pending' as const }
          : { status: 'failed' as const, error: chosen.error, finishedAt: now }),
      });
      return chosen;
    });
  } catch (error) {
    await store.delete(id);
    throw error;
  }
  const started = (await findRecognition(db, scope, id))!;
  if ('recognizer' in choice) void recognize(db, choice.recognizer, scope, id, { bytes, contentType });
  return started;
}

// Past this the member is better off entering the screenshot by hand than waiting on.
const recognitionDeadline = 2 * 60 * 1000;

function withDeadline<T>(work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function recognize(
  db: Database,
  recognizer: ScreenshotRecognizer,
  scope: CurrentMember,
  id: string,
  screenshot: Screenshot,
) {
  try {
    const result = await withDeadline(recognizer.recognize(screenshot), recognitionDeadline);
    await saveDrafts(db, scope, id, result);
  } catch (error) {
    console.error(`Recognition ${id} failed`, error);
    await db
      .update(recognition)
      .set({ status: 'failed', error: 'recognition_failed', finishedAt: new Date() })
      .where(and(eq(recognition.id, id), eq(recognition.status, 'pending')))
      .catch((e) => console.error(`Could not mark recognition ${id} as failed`, e));
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// Shares the order discounts' total over the drafts by List Price. A draft's share is null while any List Price
// is unknown, or when the total would leave a draft free, since then no proportional share is right.
function shareOrderDiscounts(orderDiscounts: readonly Discount[], listPrices: readonly (number | null)[]) {
  const total = orderDiscounts.reduce((sum, d) => sum + d.amount, 0);
  if (total === 0) return listPrices.map(() => 0);
  if (!listPrices.every((p) => p !== null)) return listPrices.map(() => null);
  const orderTotal = listPrices.reduce((sum, p) => sum + p, 0);
  if (total > orderTotal - listPrices.length) return listPrices.map(() => null);
  return allocateDiscount(total, listPrices);
}

async function saveDrafts(db: Database, scope: CurrentMember, id: string, result: RecognitionResult) {
  await db.transaction(async (tx) => {
    // Holding the suggested products keeps them from being deleted or merged away before the drafts commit.
    const products = await tx
      .select({ id: product.id, name: product.name })
      .from(product)
      .where(and(eq(product.householdId, scope.householdId), isNull(product.archivedAt)))
      .for('key share');
    const [finished] = await tx
      .update(recognition)
      .set({ status: 'succeeded', result, finishedAt: new Date() })
      .where(and(eq(recognition.id, id), eq(recognition.status, 'pending')))
      .returning({ id: recognition.id });
    // A restart in the meantime has already given up on it.
    if (!finished || result.items.length === 0) return;
    const shares = shareOrderDiscounts(
      result.orderDiscounts,
      result.items.map((item) => item.listPrice),
    );
    await tx.insert(recognitionDraft).values(
      result.items.map((item, position) => {
        const size = item.sizeText === null ? null : parseSize(item.sizeText);
        return {
          householdId: scope.householdId,
          recognitionId: id,
          position,
          name: item.name,
          sizeText: item.sizeText,
          sizeAmount: size?.amount ?? null,
          sizeUnitDimension: size?.unit.dimension ?? null,
          sizeUnitName: size?.unit.name ?? null,
          quantity: item.quantity,
          listPrice: item.listPrice,
          discounts: item.discounts,
          orderDiscount: shares[position]!,
          productId: searchByName(products, item.name)[0]?.id ?? null,
        };
      }),
    );
  });
}

// Recognitions run inside the server process, so the ones still pending at startup were cut off by a restart.
export async function failInterruptedRecognitions(db: Database) {
  await db
    .update(recognition)
    .set({ status: 'failed', error: 'recognition_interrupted', finishedAt: new Date() })
    .where(eq(recognition.status, 'pending'));
}

export async function findRecognition(db: Database, scope: CurrentMember, id: string) {
  const [found] = await db
    .select({
      id: recognition.id,
      status: recognition.status,
      error: recognition.error,
      requestedById: user.id,
      requestedByName: user.name,
      screenshotContentType: recognition.screenshotContentType,
      screenshotSize: recognition.screenshotSize,
      result: recognition.result,
      createdAt: recognition.createdAt,
      finishedAt: recognition.finishedAt,
      confirmedAt: recognition.confirmedAt,
    })
    .from(recognition)
    .leftJoin(user, eq(user.id, recognition.requestedBy))
    .where(and(eq(recognition.householdId, scope.householdId), eq(recognition.id, id)));
  if (!found) return null;

  const drafts = await db
    .select({
      id: recognitionDraft.id,
      name: recognitionDraft.name,
      sizeText: recognitionDraft.sizeText,
      sizeAmount: recognitionDraft.sizeAmount,
      sizeUnitDimension: recognitionDraft.sizeUnitDimension,
      sizeUnitName: recognitionDraft.sizeUnitName,
      quantity: recognitionDraft.quantity,
      listPrice: recognitionDraft.listPrice,
      discounts: recognitionDraft.discounts,
      orderDiscount: recognitionDraft.orderDiscount,
      product: {
        id: product.id,
        name: product.name,
        pricingUnitDimension: product.pricingUnitDimension,
        pricingUnitName: product.pricingUnitName,
        baseSize: product.baseSize,
      },
    })
    .from(recognitionDraft)
    .leftJoin(
      product,
      and(eq(product.householdId, recognitionDraft.householdId), eq(product.id, recognitionDraft.productId)),
    )
    .where(and(eq(recognitionDraft.householdId, scope.householdId), eq(recognitionDraft.recognitionId, id)))
    .orderBy(asc(recognitionDraft.position));

  const { requestedById, requestedByName, screenshotContentType, screenshotSize, result, ...rest } = found;
  return {
    ...rest,
    requestedBy: requestedById === null ? null : { id: requestedById, name: requestedByName! },
    screenshot: { contentType: screenshotContentType, size: screenshotSize },
    date: result?.date ?? null,
    channel: result?.channel ?? null,
    orderDiscounts: result?.orderDiscounts ?? [],
    drafts: drafts.map(({ sizeAmount, sizeUnitDimension, sizeUnitName, product: suggested, ...draft }) => ({
      ...draft,
      size:
        sizeAmount === null
          ? null
          : { amount: sizeAmount, unit: { dimension: sizeUnitDimension, name: sizeUnitName } as Unit },
      suggestedProduct: suggested && {
        id: suggested.id,
        name: suggested.name,
        pricingUnit: { dimension: suggested.pricingUnitDimension, name: suggested.pricingUnitName } as Unit,
        baseSize: suggested.baseSize,
      },
    })),
  };
}

export async function readScreenshot(db: Database, store: EvidenceStore, scope: CurrentMember, id: string) {
  const [found] = await db
    .select({ contentType: recognition.screenshotContentType })
    .from(recognition)
    .where(and(eq(recognition.householdId, scope.householdId), eq(recognition.id, id)));
  if (!found) return null;
  const bytes = await store.get(id);
  return bytes && { contentType: found.contentType, bytes };
}

export class RecognitionConfirmedError extends Error {
  override name = 'RecognitionConfirmedError';
}

export class NoDraftsError extends Error {
  override name = 'NoDraftsError';
}

// Names the draft that kept the recognition from being confirmed, and why.
export class DraftRejectedError extends Error {
  override name = 'DraftRejectedError';
  constructor(
    readonly draftId: string,
    readonly reason: 'draft_incomplete' | 'incompatible_unit' | 'invalid_price',
  ) {
    super(`Draft ${draftId} cannot be confirmed: ${reason}`);
  }
}

// Holding the recognition serializes edits and confirmation, so no edit lands on a draft once it is confirmed.
async function lockRecognition(tx: Transaction, scope: CurrentMember, id: string) {
  const [found] = await tx
    .select({ result: recognition.result, confirmedAt: recognition.confirmedAt })
    .from(recognition)
    .where(and(eq(recognition.householdId, scope.householdId), eq(recognition.id, id)))
    .for('update');
  if (!found) return null;
  if (found.confirmedAt) throw new RecognitionConfirmedError();
  return found;
}

function draftsOf(tx: Transaction, scope: CurrentMember, recognitionId: string) {
  return tx
    .select()
    .from(recognitionDraft)
    .where(and(eq(recognitionDraft.householdId, scope.householdId), eq(recognitionDraft.recognitionId, recognitionId)))
    .orderBy(asc(recognitionDraft.position));
}

async function reshareOrderDiscounts(
  tx: Transaction,
  scope: CurrentMember,
  recognitionId: string,
  orderDiscounts: readonly Discount[],
) {
  const drafts = await draftsOf(tx, scope, recognitionId);
  const shares = shareOrderDiscounts(
    orderDiscounts,
    drafts.map((d) => d.listPrice),
  );
  for (const [i, draft] of drafts.entries()) {
    if (draft.orderDiscount === shares[i]) continue;
    await tx
      .update(recognitionDraft)
      .set({ orderDiscount: shares[i] })
      .where(and(eq(recognitionDraft.householdId, scope.householdId), eq(recognitionDraft.id, draft.id)));
  }
}

export interface DraftChanges {
  name?: string;
  size?: Size | null;
  quantity?: number | null;
  listPrice?: number | null;
  discounts?: Discount[];
  orderDiscount?: number;
  productId?: string | null;
}

// A new List Price shares the order discounts out again, and a share given in the same changes is applied after.
// Returns false when the recognition or the draft is not in the household.
export function editDraft(
  db: Database,
  scope: CurrentMember,
  recognitionId: string,
  draftId: string,
  changes: DraftChanges,
) {
  const { size, ...rest } = changes;
  return translate(
    () =>
      db.transaction(async (tx) => {
        const locked = await lockRecognition(tx, scope, recognitionId);
        if (!locked) return false;
        const thisDraft = and(
          eq(recognitionDraft.householdId, scope.householdId),
          eq(recognitionDraft.recognitionId, recognitionId),
          eq(recognitionDraft.id, draftId),
        );
        const updated = await tx
          .update(recognitionDraft)
          .set({
            ...rest,
            ...(size === undefined
              ? {}
              : {
                  sizeAmount: size?.amount ?? null,
                  sizeUnitDimension: size?.unit.dimension ?? null,
                  sizeUnitName: size?.unit.name ?? null,
                }),
          })
          .where(thisDraft)
          .returning({ id: recognitionDraft.id });
        if (updated.length === 0) return false;
        if (changes.listPrice !== undefined) {
          await reshareOrderDiscounts(tx, scope, recognitionId, locked.result?.orderDiscounts ?? []);
          if (rest.orderDiscount !== undefined) {
            await tx.update(recognitionDraft).set({ orderDiscount: rest.orderDiscount }).where(thisDraft);
          }
        }
        return true;
      }),
    ProductNotFoundError,
  );
}

// The order discounts are shared out again over the drafts that remain.
// Returns false when the recognition or the draft is not in the household.
export function deleteDraft(db: Database, scope: CurrentMember, recognitionId: string, draftId: string) {
  return db.transaction(async (tx) => {
    const locked = await lockRecognition(tx, scope, recognitionId);
    if (!locked) return false;
    const deleted = await tx
      .delete(recognitionDraft)
      .where(
        and(
          eq(recognitionDraft.householdId, scope.householdId),
          eq(recognitionDraft.recognitionId, recognitionId),
          eq(recognitionDraft.id, draftId),
        ),
      )
      .returning({ id: recognitionDraft.id });
    if (deleted.length === 0) return false;
    await reshareOrderDiscounts(tx, scope, recognitionId, locked.result?.orderDiscounts ?? []);
    return true;
  });
}

export interface Confirmation {
  date: string;
  channelId: string;
  purchased: boolean;
  // Null for none; omitted to tag each record with the Promotion its date falls in.
  promotionId?: string | null;
}

type Draft = Awaited<ReturnType<typeof draftsOf>>[number];

// Share-locks the drafts' products in id order, the order merges lock them in, so neither waits on the other in
// a cycle. A merge that committed meanwhile may have moved a draft, so the drafts are read until they stay put.
async function lockDraftProducts(tx: Transaction, scope: CurrentMember, recognitionId: string) {
  let drafts = await draftsOf(tx, scope, recognitionId);
  for (;;) {
    const productIds = [...new Set(drafts.flatMap((d) => (d.productId === null ? [] : [d.productId])))].sort();
    if (productIds.length > 0) {
      await tx
        .select({ id: product.id })
        .from(product)
        .where(and(eq(product.householdId, scope.householdId), inArray(product.id, productIds)))
        .orderBy(asc(product.id))
        .for('share');
    }
    const again = await draftsOf(tx, scope, recognitionId);
    if (again.length === drafts.length && again.every((d, i) => d.productId === drafts[i]!.productId)) return again;
    drafts = again;
  }
}

function recordOf(draft: Draft, orderDiscounts: readonly Discount[], input: Confirmation) {
  const { productId, sizeAmount, sizeUnitDimension, sizeUnitName, quantity, listPrice, orderDiscount } = draft;
  if (
    productId === null ||
    sizeAmount === null ||
    quantity === null ||
    quantity <= 0 ||
    listPrice === null ||
    listPrice <= 0 ||
    orderDiscount === null
  ) {
    throw new DraftRejectedError(draft.id, 'draft_incomplete');
  }
  const name = orderDiscounts.flatMap((d) => (d.name ? [d.name] : [])).join('、');
  const share: Discount[] =
    orderDiscount === 0 ? [] : [name ? { amount: orderDiscount, name } : { amount: orderDiscount }];
  return {
    ...input,
    productId,
    listPrice,
    quantity,
    size: { amount: sizeAmount, unit: { dimension: sizeUnitDimension, name: sizeUnitName } as Unit },
    discounts: [...draft.discounts, ...share],
  };
}

// Writes every draft as a recognized price record carrying a copy of the screenshot as its Evidence, then
// removes the drafts; all of it commits together or not at all.
// Returns null when the recognition is not in the household.
export async function confirmRecognition(
  db: Database,
  store: EvidenceStore,
  scope: CurrentMember,
  id: string,
  input: Confirmation,
) {
  const screenshot = await readScreenshot(db, store, scope, id);
  if (!screenshot) return null;
  const [found] = await db
    .select({ status: recognition.status, drafts: sql<number>`count(${recognitionDraft.id})::int` })
    .from(recognition)
    .leftJoin(
      recognitionDraft,
      and(
        eq(recognitionDraft.householdId, recognition.householdId),
        eq(recognitionDraft.recognitionId, recognition.id),
      ),
    )
    .where(and(eq(recognition.householdId, scope.householdId), eq(recognition.id, id)))
    .groupBy(recognition.id);
  if (!found) return null;
  // A finished recognition only ever loses drafts, so there are at most this many to write by the time the
  // transaction below holds it; a pending one could still gain them.
  if (found.status !== 'succeeded') throw new NoDraftsError();
  // Each record gets its own file, since a record's Evidence files go when the record does. They are written
  // before the transaction opens, so it stays short.
  const copies = Array.from({ length: found.drafts }, () => crypto.randomUUID());

  let kept = 0;
  try {
    await Promise.all(copies.map((key) => store.put(key, screenshot.bytes)));
    const confirmed = await translate(
      () =>
        db.transaction(async (tx) => {
          const locked = await lockRecognition(tx, scope, id);
          if (!locked) return null;
          const drafts = await lockDraftProducts(tx, scope, id);
          if (drafts.length === 0) throw new NoDraftsError();
          const orderDiscounts = locked.result?.orderDiscounts ?? [];

          const recordIds: string[] = [];
          for (const [i, draft] of drafts.entries()) {
            let recordId;
            try {
              recordId = await insertPriceRecord(tx, scope, recordOf(draft, orderDiscounts, input), 'recognition');
            } catch (error) {
              if (error instanceof IncompatibleUnitsError) throw new DraftRejectedError(draft.id, 'incompatible_unit');
              if (error instanceof InvalidPriceError) throw new DraftRejectedError(draft.id, 'invalid_price');
              throw error;
            }
            await tx.insert(evidence).values({
              id: copies[i]!,
              householdId: scope.householdId,
              priceRecordId: recordId,
              contentType: screenshot.contentType,
              size: screenshot.bytes.length,
              uploadedBy: scope.userId,
            });
            recordIds.push(recordId);
          }

          await tx
            .delete(recognitionDraft)
            .where(and(eq(recognitionDraft.householdId, scope.householdId), eq(recognitionDraft.recognitionId, id)));
          await tx.update(recognition).set({ confirmedAt: new Date() }).where(eq(recognition.id, id));
          return Promise.all(recordIds.map(async (recordId) => (await findPriceRecord(tx, scope, recordId))!));
        }),
      ParentNotFoundError,
    );
    kept = confirmed?.length ?? 0;
    return confirmed;
  } finally {
    await removeEvidenceFiles(store, copies.slice(kept));
  }
}
