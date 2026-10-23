import { describe, expect, test } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicRecognizer } from '../src/anthropic-recognizer';
import type { Screenshot } from '../src/recognizer';

const screenshot: Screenshot = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), contentType: 'image/png' };

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

function message(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

// Answers every Messages API call with `respond`, recording the request bodies it was sent.
function fakeApi(respond: () => Response) {
  const requests: Record<string, any>[] = [];
  const client = new Anthropic({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return respond();
    },
  });
  return { client, requests };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('anthropicRecognizer', () => {
  test('sends the screenshot to the configured model and reads the answer in cents', async () => {
    const { client, requests } = fakeApi(() => json(message(JSON.stringify(answer))));

    const result = await anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot);

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
    expect(request!.model).toBe('claude-haiku-5-5');
    expect(request!.output_config.format.type).toBe('json_schema');
    expect(request!.messages[0].content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from(screenshot.bytes).toString('base64') },
    });
  });

  test('rounds prices to whole cents', async () => {
    const item = { name: '牛奶', sizeText: '250ml', quantity: 1, listPrice: 4.199999, discounts: [] };
    const { client } = fakeApi(() => json(message(JSON.stringify({ ...answer, items: [item], orderDiscounts: [] }))));
    const result = await anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot);
    expect(result.items[0]!.listPrice).toBe(420);
  });

  test.each([
    ['text that is not JSON', 'Sorry, I cannot read this.'],
    ['an answer missing fields', JSON.stringify({ items: [] })],
    ['a date that is not YYYY-MM-DD', JSON.stringify({ ...answer, date: '6月18日' })],
    ['an impossible date', JSON.stringify({ ...answer, date: '2026-02-30' })],
    ['a fractional quantity', JSON.stringify({ ...answer, items: [{ ...answer.items[0], quantity: 1.5 }] })],
    ['a negative price', JSON.stringify({ ...answer, items: [{ ...answer.items[0], listPrice: -1 }] })],
    ['a discount of nothing', JSON.stringify({ ...answer, orderDiscounts: [{ amount: 0, name: null }] })],
    ['a nameless item', JSON.stringify({ ...answer, items: [{ ...answer.items[0], name: ' ' }] })],
  ])('rejects %s', async (_label, text) => {
    const { client } = fakeApi(() => json(message(text)));
    await expect(anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot)).rejects.toThrow();
  });

  test.each(['refusal', 'max_tokens'])('rejects an answer that stopped with %s', async (stopReason) => {
    const { client } = fakeApi(() => json(message(JSON.stringify(answer), stopReason)));
    await expect(anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot)).rejects.toThrow(stopReason);
  });

  test('rejects when the API call fails', async () => {
    const { client } = fakeApi(() => json({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500));
    await expect(anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot)).rejects.toThrow(
      Anthropic.InternalServerError,
    );
  });
});
