import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { anthropicRecognizer } from './anthropic-recognizer';
import { openaiRecognizer } from './openai-recognizer';
import {
  RecognizerCallError,
  type RecognitionProvider,
  type RecognizerConfig,
  type RecognizerFactory,
  type RecognizerProblem,
  type RecognizerValidation,
  type ScreenshotRecognizer,
} from './recognizer';

// Both read images and keep to a JSON schema, and are cheap enough to run on every screenshot.
export const defaultModels: Record<RecognitionProvider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-5-mini',
};

// Recognitions give up after two minutes, so a slow call retries once at most and stops by then.
const recognizing = { timeout: 55_000, maxRetries: 1 };
// Someone is waiting on the answer while the configuration is checked.
const validating = { timeout: 20_000, maxRetries: 0 };

const probe = 'Reply with OK.';

type SdkErrors = Pick<
  typeof Anthropic | typeof OpenAI,
  'APIError' | 'APIConnectionError' | 'AuthenticationError' | 'PermissionDeniedError' | 'NotFoundError'
>;

function problemOf(error: unknown, sdk: SdkErrors): RecognizerProblem {
  if (error instanceof sdk.APIConnectionError) return 'unreachable';
  if (error instanceof sdk.AuthenticationError || error instanceof sdk.PermissionDeniedError) {
    return 'authentication_failed';
  }
  if (error instanceof sdk.NotFoundError) return 'model_not_found';
  if (error instanceof sdk.APIError) return 'provider_error';
  throw error;
}

function reportingCallErrors(recognizer: ScreenshotRecognizer, sdk: SdkErrors): ScreenshotRecognizer {
  return {
    async recognize(screenshot) {
      try {
        return await recognizer.recognize(screenshot);
      } catch (error) {
        if (error instanceof sdk.APIError) throw new RecognizerCallError(problemOf(error, sdk), error.message);
        throw error;
      }
    },
  };
}

// `fetch` stands in for the network, so tests can play the provider's side.
export function providerRecognizers({
  fetch,
}: { fetch?: (url: string | URL | Request, init?: RequestInit) => Promise<Response> } = {}): RecognizerFactory {
  function client({ provider, apiKey, baseURL }: RecognizerConfig, options: typeof recognizing) {
    const settings = { apiKey, baseURL, fetch, ...options };
    return provider === 'anthropic'
      ? { provider, client: new Anthropic(settings) }
      : { provider, client: new OpenAI(settings) };
  }

  return {
    create(config) {
      const model = config.model || defaultModels[config.provider];
      const sdk = client(config, recognizing);
      return sdk.provider === 'anthropic'
        ? reportingCallErrors(anthropicRecognizer(sdk.client, model), Anthropic)
        : reportingCallErrors(openaiRecognizer(sdk.client, model), OpenAI);
    },

    async validate(config): Promise<RecognizerValidation> {
      const model = config.model || defaultModels[config.provider];
      const sdk = client(config, validating);
      const messages = [{ role: 'user' as const, content: probe }];
      try {
        if (sdk.provider === 'anthropic') await sdk.client.messages.create({ model, max_tokens: 1, messages });
        else await sdk.client.chat.completions.create({ model, messages });
        return { ok: true };
      } catch (error) {
        const problem = problemOf(error, sdk.provider === 'anthropic' ? Anthropic : OpenAI);
        return { ok: false, problem, message: (error as Error).message };
      }
    },
  };
}
