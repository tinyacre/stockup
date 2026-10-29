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

export const recognitionProviders = ['anthropic', 'openai'] as const;
export type RecognitionProvider = (typeof recognitionProviders)[number];

// Which provider to call and how; the provider's default model stands in for a missing one. An OpenAI base URL
// points the recognizer at any service that speaks the OpenAI protocol, such as OpenRouter.
export interface RecognizerConfig {
  provider: RecognitionProvider;
  apiKey: string;
  baseURL?: string;
  model?: string;
}

// Why a provider turned a configuration down: the key, the model, the connection, or anything else it reported.
export type RecognizerProblem = 'authentication_failed' | 'model_not_found' | 'unreachable' | 'provider_error';

export type RecognizerValidation = { ok: true } | { ok: false; problem: RecognizerProblem; message: string };

// Builds recognizers from a configuration, the instance's or a household's, and checks one against its provider
// before it is relied on.
export interface RecognizerFactory {
  create(config: RecognizerConfig): ScreenshotRecognizer;
  validate(config: RecognizerConfig): Promise<RecognizerValidation>;
}
