import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { anthropicRecognizer, probeAnthropic } from './anthropic-recognizer';
import { openaiRecognizer, probeOpenAI } from './openai-recognizer';
import { NonPublicEndpointError, type Fetch } from './public-endpoint';
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

interface ClientSettings {
  apiKey: string;
  baseURL?: string;
  fetch: Fetch;
  timeout: number;
  maxRetries: number;
}

type SdkErrors = Pick<
  typeof Anthropic | typeof OpenAI,
  'APIError' | 'APIConnectionError' | 'AuthenticationError' | 'PermissionDeniedError' | 'NotFoundError'
>;

interface Provider<Client> {
  errors: SdkErrors;
  client(settings: ClientSettings): Client;
  recognizer(client: Client, model: string): ScreenshotRecognizer;
  probe(client: Client, model: string): Promise<void>;
}

interface Clients {
  anthropic: Anthropic;
  openai: OpenAI;
}

const providers: { [P in RecognitionProvider]: Provider<Clients[P]> } = {
  anthropic: {
    errors: Anthropic,
    client: (settings) => new Anthropic(settings),
    recognizer: anthropicRecognizer,
    probe: probeAnthropic,
  },
  openai: {
    errors: OpenAI,
    client: (settings) => new OpenAI(settings),
    recognizer: openaiRecognizer,
    probe: probeOpenAI,
  },
};

function modelOf(config: RecognizerConfig) {
  return config.model || defaultModels[config.provider];
}

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
        if (error instanceof sdk.APIError) throw new RecognizerCallError(error.message);
        throw error;
      }
    },
  };
}

// `fetch` stands in for the network, so tests can play the provider's side; a fetch that refuses some hosts keeps
// every call the factory makes away from them.
export function providerRecognizers({ fetch = globalThis.fetch }: { fetch?: Fetch } = {}): RecognizerFactory {
  function connect<P extends RecognitionProvider>(
    config: RecognizerConfig & { provider: P },
    options: typeof recognizing,
  ) {
    const provider: Provider<Clients[P]> = providers[config.provider];
    const client = provider.client({ apiKey: config.apiKey, baseURL: config.baseURL, fetch, ...options });
    const model = modelOf(config);
    return {
      errors: provider.errors,
      recognizer: () => provider.recognizer(client, model),
      probe: () => provider.probe(client, model),
    };
  }

  return {
    create(config) {
      const provider = connect(config, recognizing);
      return reportingCallErrors(provider.recognizer(), provider.errors);
    },

    async validate(config): Promise<RecognizerValidation> {
      const provider = connect(config, validating);
      try {
        await provider.probe();
        return { ok: true };
      } catch (error) {
        return { ok: false, problem: problemOf(error, provider.errors), message: (error as Error).message };
      }
    },
  };
}
