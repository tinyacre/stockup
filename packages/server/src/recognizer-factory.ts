import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { anthropicRecognizer } from './anthropic-recognizer';
import { openaiRecognizer } from './openai-recognizer';
import { NonPublicEndpointError, publicOnly, resolveHost, type Fetch, type ResolveHost } from './public-endpoint';
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

// An 8×8 red PNG, so a model that cannot read images fails the check rather than the first screenshot.
const probeImage =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mO4oKCAFTEMLQkAvk5EAYUHFA8AAAAASUVORK5CYII=';
const probeText = 'What colour is this image? Answer in one word.';
// Only whether the call succeeds matters; reasoning models spend part of their allowance before answering, so
// OpenAI's is larger.
const probeTokens = { anthropic: 16, openai: 256 };

function modelOf(config: RecognizerConfig) {
  return config.model || defaultModels[config.provider];
}

type SdkErrors = Pick<
  typeof Anthropic | typeof OpenAI,
  'APIError' | 'APIConnectionError' | 'AuthenticationError' | 'PermissionDeniedError' | 'NotFoundError'
>;

function problemOf(error: unknown, sdk: SdkErrors): RecognizerProblem {
  if (error instanceof sdk.APIConnectionError) {
    return error.cause instanceof NonPublicEndpointError ? 'endpoint_not_public' : 'unreachable';
  }
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

// `fetch` and `resolve` stand in for the network and DNS, so tests can play the provider's side.
export function providerRecognizers({
  fetch = globalThis.fetch,
  resolve = resolveHost,
}: { fetch?: Fetch; resolve?: ResolveHost } = {}): RecognizerFactory {
  const publicFetch = publicOnly(fetch, resolve);

  function client({ provider, apiKey, baseURL, publicEndpointOnly }: RecognizerConfig, options: typeof recognizing) {
    const settings = { apiKey, baseURL, fetch: publicEndpointOnly ? publicFetch : fetch, ...options };
    return provider === 'anthropic'
      ? { provider, client: new Anthropic(settings) }
      : { provider, client: new OpenAI(settings) };
  }

  return {
    create(config) {
      const model = modelOf(config);
      const sdk = client(config, recognizing);
      return sdk.provider === 'anthropic'
        ? reportingCallErrors(anthropicRecognizer(sdk.client, model), Anthropic)
        : reportingCallErrors(openaiRecognizer(sdk.client, model), OpenAI);
    },

    async validate(config): Promise<RecognizerValidation> {
      const model = modelOf(config);
      const sdk = client(config, validating);
      try {
        if (sdk.provider === 'anthropic') {
          await sdk.client.messages.create({
            model,
            max_tokens: probeTokens.anthropic,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: probeImage } },
                  { type: 'text', text: probeText },
                ],
              },
            ],
          });
        } else {
          await sdk.client.chat.completions.create({
            model,
            max_completion_tokens: probeTokens.openai,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: `data:image/png;base64,${probeImage}` } },
                  { type: 'text', text: probeText },
                ],
              },
            ],
          });
        }
        return { ok: true };
      } catch (error) {
        const problem = problemOf(error, sdk.provider === 'anthropic' ? Anthropic : OpenAI);
        return { ok: false, problem, message: (error as Error).message };
      }
    },
  };
}
