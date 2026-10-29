import { describe, expect, test } from 'bun:test';
import { RecognizerCallError, type RecognizerConfig, type Screenshot } from '../src/recognizer';
import { providerRecognizers } from '../src/recognizer-factory';

const screenshot: Screenshot = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), contentType: 'image/png' };

const answer = JSON.stringify({ items: [], orderDiscounts: [], date: null, channel: null });

const replies = {
  anthropic: {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: answer }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  openai: {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-5-mini',
    choices: [{ index: 0, message: { role: 'assistant', content: answer, refusal: null }, finish_reason: 'stop' }],
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Plays the provider's side of every call, recording what each was sent.
function fakeProviders(respond: () => Response | Promise<Response>) {
  const requests: { url: string; headers: Headers; body: Record<string, any> }[] = [];
  const recognizers = providerRecognizers({
    fetch: async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return respond();
    },
  });
  return { recognizers, requests };
}

const anthropic: RecognizerConfig = { provider: 'anthropic', apiKey: 'sk-ant-test' };
const openai: RecognizerConfig = { provider: 'openai', apiKey: 'sk-test' };

describe('providerRecognizers', () => {
  test('reads screenshots with Claude Haiku 5.5 from Anthropic unless another model is set', async () => {
    const { recognizers, requests } = fakeProviders(() => json(replies.anthropic));

    await recognizers.create(anthropic).recognize(screenshot);
    await recognizers.create({ ...anthropic, model: 'claude-sonnet-5-5' }).recognize(screenshot);

    expect(requests.map((r) => r.url)).toEqual([
      'https://api.anthropic.com/v1/messages',
      'https://api.anthropic.com/v1/messages',
    ]);
    expect(requests[0]!.headers.get('x-api-key')).toBe('sk-ant-test');
    expect(requests.map((r) => r.body.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
  });

  test('reads screenshots with GPT-5 mini from OpenAI unless another model is set', async () => {
    const { recognizers, requests } = fakeProviders(() => json(replies.openai));

    await recognizers.create(openai).recognize(screenshot);
    await recognizers.create({ ...openai, model: 'gpt-5' }).recognize(screenshot);

    expect(requests[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer sk-test');
    expect(requests.map((r) => r.body.model)).toEqual(['gpt-5-mini', 'gpt-5']);
  });

  test('calls an OpenAI-compatible service at its base URL', async () => {
    const { recognizers, requests } = fakeProviders(() => json(replies.openai));
    const openRouter = { ...openai, baseURL: 'https://openrouter.example/api/v1', model: 'google/gemini-3-flash' };

    expect(await recognizers.create(openRouter).recognize(screenshot)).toEqual({
      items: [],
      orderDiscounts: [],
      date: null,
      channel: null,
    });
    expect(await recognizers.validate(openRouter)).toEqual({ ok: true });
    expect(requests.map((r) => r.url)).toEqual([
      'https://openrouter.example/api/v1/chat/completions',
      'https://openrouter.example/api/v1/chat/completions',
    ]);
    expect(requests.map((r) => r.body.model)).toEqual(['google/gemini-3-flash', 'google/gemini-3-flash']);
  });

  describe.each([
    {
      config: anthropic,
      reply: replies.anthropic,
      error: (status: number, type: string) =>
        json({ type: 'error', error: { type, message: `${type} here` } }, status),
    },
    {
      config: openai,
      reply: replies.openai,
      error: (status: number, type: string) => json({ error: { type, code: type, message: `${type} here` } }, status),
    },
  ])('validating a $config.provider configuration', ({ config, reply, error }) => {
    test('accepts one the provider answers, asking the model it names', async () => {
      const { recognizers, requests } = fakeProviders(() => json(reply));
      expect(await recognizers.validate({ ...config, model: 'some-model' })).toEqual({ ok: true });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.body.model).toBe('some-model');
    });

    test.each([
      [401, 'authentication_error', 'authentication_failed'],
      [403, 'permission_error', 'authentication_failed'],
      [404, 'not_found_error', 'model_not_found'],
      [402, 'insufficient_quota', 'provider_error'],
      [400, 'invalid_request_error', 'provider_error'],
    ])('reports a %i answer as %s → %s', async (status, type, problem) => {
      const { recognizers } = fakeProviders(() => error(status, type));
      expect(await recognizers.validate(config)).toMatchObject({
        ok: false,
        problem,
        message: expect.stringContaining(`${type} here`),
      });
    });

    test('reports a provider it cannot reach as unreachable', async () => {
      const { recognizers } = fakeProviders(() => {
        throw new TypeError('fetch failed');
      });
      expect(await recognizers.validate(config)).toMatchObject({ ok: false, problem: 'unreachable' });
    });
  });

  describe.each([
    {
      config: anthropic,
      refused: json({ type: 'error', error: { type: 'authentication_error', message: 'no' } }, 401),
      garbled: json({ ...replies.anthropic, content: [{ type: 'text', text: 'not json' }] }),
    },
    {
      config: openai,
      refused: json({ error: { type: 'invalid_api_key', code: 'invalid_api_key', message: 'no' } }, 401),
      garbled: json({
        ...replies.openai,
        choices: [{ ...replies.openai.choices[0], message: { role: 'assistant', content: 'not json', refusal: null } }],
      }),
    },
  ])('a $config.provider recognizer', ({ config, refused, garbled }) => {
    test('reports a call the provider refuses as a call error', async () => {
      const { recognizers } = fakeProviders(() => refused);
      const error = await recognizers
        .create(config)
        .recognize(screenshot)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RecognizerCallError);
      expect(error).toMatchObject({ problem: 'authentication_failed' });
    });

    test('reports an answer it cannot read as an ordinary error', async () => {
      const { recognizers } = fakeProviders(() => garbled);
      const error = await recognizers
        .create(config)
        .recognize(screenshot)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RecognizerCallError);
    });
  });
});
