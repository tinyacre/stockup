import { describe, expect, test } from 'bun:test';
import OpenAI from 'openai';
import { openaiRecognizer } from '../src/openai-recognizer';
import type { Screenshot } from '../src/recognizer';

const screenshot: Screenshot = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), contentType: 'image/jpeg' };

const answer = {
  items: [
    {
      name: '得宝抽纸 M码',
      sizeText: '100抽',
      quantity: 18,
      listPrice: 99,
      discounts: [{ amount: 10.5, name: 'plus 券' }],
    },
    { name: '皇家猫粮', sizeText: null, quantity: null, listPrice: null, discounts: [{ amount: 3, name: null }] },
  ],
  orderDiscounts: [{ amount: 20, name: '满 199 减 20' }],
  date: '2026-06-18',
  channel: '京东',
};

function completion(content: string | null, finishReason = 'stop', refusal: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-5-mini',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

// Answers every Chat Completions call with `respond`, recording the URLs and request bodies it was sent.
function fakeApi(respond: () => Response) {
  const requests: { url: string; body: Record<string, any> }[] = [];
  const client = new OpenAI({
    apiKey: 'test-key',
    baseURL: 'https://openrouter.example/api/v1',
    maxRetries: 0,
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return respond();
    },
  });
  return { client, requests };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('openaiRecognizer', () => {
  test('sends the screenshot to the configured model at the base URL and reads the answer in cents', async () => {
    const { client, requests } = fakeApi(() => json(completion(JSON.stringify(answer))));

    const result = await openaiRecognizer(client, 'google/gemini-3-flash').recognize(screenshot);

    expect(result).toEqual({
      items: [
        {
          name: '得宝抽纸 M码',
          sizeText: '100抽',
          quantity: 18,
          listPrice: 9900,
          discounts: [{ amount: 1050, name: 'plus 券' }],
        },
        { name: '皇家猫粮', sizeText: null, quantity: null, listPrice: null, discounts: [{ amount: 300 }] },
      ],
      orderDiscounts: [{ amount: 2000, name: '满 199 减 20' }],
      date: '2026-06-18',
      channel: '京东',
    });
    const [request] = requests;
    expect(request!.url).toBe('https://openrouter.example/api/v1/chat/completions');
    expect(request!.body.model).toBe('google/gemini-3-flash');
    expect(request!.body.response_format.type).toBe('json_schema');
    expect(request!.body.response_format.json_schema.strict).toBe(true);
    expect(request!.body.messages.at(-1).content).toContainEqual({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${Buffer.from(screenshot.bytes).toString('base64')}` },
    });
  });

  test('rounds prices to whole cents', async () => {
    const item = { name: '牛奶', sizeText: '250ml', quantity: 1, listPrice: 4.199999, discounts: [] };
    const { client } = fakeApi(() =>
      json(completion(JSON.stringify({ ...answer, items: [item], orderDiscounts: [] }))),
    );
    const result = await openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot);
    expect(result.items[0]!.listPrice).toBe(420);
  });

  test.each([
    ['text that is not JSON', 'Sorry, I cannot read this.'],
    ['an answer missing fields', JSON.stringify({ items: [] })],
    ['an impossible date', JSON.stringify({ ...answer, date: '2026-02-30' })],
    ['a fractional quantity', JSON.stringify({ ...answer, items: [{ ...answer.items[0], quantity: 1.5 }] })],
    ['a negative price', JSON.stringify({ ...answer, items: [{ ...answer.items[0], listPrice: -1 }] })],
    ['a discount of nothing', JSON.stringify({ ...answer, orderDiscounts: [{ amount: 0, name: null }] })],
  ])('rejects %s', async (_label, text) => {
    const { client } = fakeApi(() => json(completion(text)));
    await expect(openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot)).rejects.toThrow();
  });

  test.each(['length', 'content_filter'])('rejects an answer that stopped with %s', async (finishReason) => {
    const { client } = fakeApi(() => json(completion(JSON.stringify(answer), finishReason)));
    await expect(openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot)).rejects.toThrow(finishReason);
  });

  test('rejects a refusal', async () => {
    const { client } = fakeApi(() => json(completion(null, 'stop', 'I cannot help with that.')));
    await expect(openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot)).rejects.toThrow('refused');
  });

  test('rejects when the API call fails', async () => {
    const { client } = fakeApi(() => json({ error: { message: 'boom', type: 'server_error' } }, 500));
    await expect(openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot)).rejects.toThrow(
      OpenAI.InternalServerError,
    );
  });
});
