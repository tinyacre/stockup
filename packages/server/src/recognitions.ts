import { and, asc, eq, isNull } from 'drizzle-orm';
import { parseSize, type Unit } from '@stockup/domain';
import { searchByName } from '@stockup/domain/search';
import type { Database } from './db';
import { product, recognition, recognitionDraft, user } from './db/schema';
import { checkEvidenceFile } from './evidence';
import type { EvidenceStore } from './evidence-store';
import type { CurrentMember } from './members';
import type { RecognitionResult, Screenshot, ScreenshotRecognizer } from './recognizer';

// Stores the screenshot and starts reading it in the background; the caller polls findRecognition
// for the outcome. Without a recognizer the recognition fails at once, keeping the screenshot for manual entry.
export async function startRecognition(
  db: Database,
  store: EvidenceStore,
  recognizer: ScreenshotRecognizer | undefined,
  scope: CurrentMember,
  bytes: Uint8Array,
) {
  const contentType = checkEvidenceFile(bytes);

  const id = crypto.randomUUID();
  await store.put(id, bytes);
  try {
    await db.insert(recognition).values({
      id,
      householdId: scope.householdId,
      requestedBy: scope.userId,
      screenshotContentType: contentType,
      screenshotSize: bytes.length,
      ...(recognizer
        ? { status: 'pending' as const }
        : { status: 'failed' as const, error: 'recognition_unavailable' as const, finishedAt: new Date() }),
    });
  } catch (error) {
    await store.delete(id);
    throw error;
  }
  const started = (await findRecognition(db, scope, id))!;
  if (recognizer) void recognize(db, recognizer, scope, id, { bytes, contentType });
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
