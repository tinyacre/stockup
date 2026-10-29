import { describe, expect, test } from 'bun:test';
import OpenAI from 'openai';
import { openaiRecognizer } from '../src/openai-recognizer';
import { readAnswer } from '../src/recognition-answer';
import type { Screenshot } from '../src/recognizer';
import { fixedRecognition } from './support/fake-recognizer';
import { json, openaiCompletion, recordingFetch } from './support/fake-provider';

const screenshot: Screenshot = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), contentType: 'image/jpeg' };

const answer = JSON.stringify(fixedRecognition);

function fakeApi(respond: () => Response) {
  const { fetch, requests } = recordingFetch(respond);
  const client = new OpenAI({ apiKey: 'test-key', baseURL: 'https://openrouter.example/api/v1', maxRetries: 0, fetch });
  return { client, requests };
}

describe('openaiRecognizer', () => {
  test('sends the screenshot to the configured model at the base URL and reads the answer', async () => {
    const { client, requests } = fakeApi(() => json(openaiCompletion(answer)));

    const result = await openaiRecognizer(client, 'google/gemini-3-flash').recognize(screenshot);

    expect(result).toEqual(readAnswer(answer));
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

  test.each(['length', 'content_filter'])('rejects an answer that stopped with %s', async (finishReason) => {
    const { client } = fakeApi(() => json(openaiCompletion(answer, finishReason)));
    await expect(openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot)).rejects.toThrow(finishReason);
  });

  test('rejects a refusal', async () => {
    const { client } = fakeApi(() => json(openaiCompletion(null, 'stop', 'I cannot help with that.')));
    await expect(openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot)).rejects.toThrow('refused');
  });

  test('rejects when the API call fails', async () => {
    const { client } = fakeApi(() => json({ error: { message: 'boom', type: 'server_error' } }, 500));
    await expect(openaiRecognizer(client, 'gpt-5-mini').recognize(screenshot)).rejects.toThrow(
      OpenAI.InternalServerError,
    );
  });
});
