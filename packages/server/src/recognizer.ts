import type { Discount } from '@stockup/domain';
import type { evidenceContentTypes } from './db/schema';

export interface Screenshot {
  bytes: Uint8Array;
  contentType: (typeof evidenceContentTypes)[number];
}

// One line of goods as the screenshot shows it; amounts are in cents, and anything unreadable is null.
export interface RecognizedItem {
  name: string;
  sizeText: string | null;
  quantity: number | null;
  listPrice: number | null;
  discounts: Discount[];
}

export interface RecognitionResult {
  items: RecognizedItem[];
  // Discounts on the whole order, such as 「满 199 减 20」, not yet shared out over the items.
  orderDiscounts: Discount[];
  // Clues the page gives about when and where, as written there: a "YYYY-MM-DD" date and a channel name.
  date: string | null;
  channel: string | null;
}

// Reads an order or product page screenshot into structured lines of goods.
export interface ScreenshotRecognizer {
  recognize(screenshot: Screenshot): Promise<RecognitionResult>;
}
