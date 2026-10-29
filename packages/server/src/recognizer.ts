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

// Which provider to call and how; null stands for the provider's own endpoint and default model. An OpenAI base URL
// points the recognizer at any service that speaks the OpenAI protocol, such as OpenRouter.
export interface RecognizerConfig {
  provider: RecognitionProvider;
  apiKey: string;
  baseURL: string | null;
  model: string | null;
}

// Why a provider turned a configuration down: the key, the model, the connection, an endpoint the server may not
// call, or anything else it reported.
export const recognizerProblems = [
  'authentication_failed',
  'model_not_found',
  'unreachable',
  'endpoint_not_public',
  'provider_error',
] as const;
export type RecognizerProblem = (typeof recognizerProblems)[number];

// The message is the provider's own wording, for the server's log.
export type RecognizerValidation = { ok: true } | { ok: false; problem: RecognizerProblem; message: string };

// A recognizer's call to its provider failed, as opposed to the provider answering with something unreadable;
// for a household's own key this means the key no longer works.
export class RecognizerCallError extends Error {
  override name = 'RecognizerCallError';
}

// Builds recognizers from a configuration and checks one against its provider before it is relied on. The instance
// and households each get a factory of their own, since households' providers are called only at public https
// addresses while the instance's operator may point it anywhere, such as a gateway on the local network.
export interface RecognizerFactory {
  create(config: RecognizerConfig): ScreenshotRecognizer;
  validate(config: RecognizerConfig): Promise<RecognizerValidation>;
}
