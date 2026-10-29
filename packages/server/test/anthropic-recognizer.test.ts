import { describe, expect, test } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicRecognizer } from '../src/anthropic-recognizer';
import { readAnswer } from '../src/recognition-answer';
import type { Screenshot } from '../src/recognizer';
import { fixedRecognition } from './support/fake-recognizer';
import { anthropicMessage, json, recordingFetch } from './support/fake-provider';

const screenshot: Screenshot = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), contentType: 'image/png' };

const answer = JSON.stringify(fixedRecognition);

function fakeApi(respond: () => Response) {
  const { fetch, requests } = recordingFetch(respond);
  return { client: new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch }), requests };
}

describe('anthropicRecognizer', () => {
  test('sends the screenshot to the configured model and reads the answer', async () => {
    const { client, requests } = fakeApi(() => json(anthropicMessage(answer)));

    const result = await anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot);

    expect(result).toEqual(readAnswer(answer));
    const [request] = requests;
    expect(request!.body.model).toBe('claude-haiku-5-5');
    expect(request!.body.output_config.format.type).toBe('json_schema');
    expect(request!.body.messages[0].content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from(screenshot.bytes).toString('base64') },
    });
  });

  test.each(['refusal', 'max_tokens'])('rejects an answer that stopped with %s', async (stopReason) => {
    const { client } = fakeApi(() => json(anthropicMessage(answer, stopReason)));
    await expect(anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot)).rejects.toThrow(stopReason);
  });

  test('rejects when the API call fails', async () => {
    const { client } = fakeApi(() => json({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500));
    await expect(anthropicRecognizer(client, 'claude-haiku-5-5').recognize(screenshot)).rejects.toThrow(
      Anthropic.InternalServerError,
    );
  });
});
