import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { answerFormat, instructions, probeImage, probeRequest, readAnswer, request } from './recognition-answer';
import type { RecognitionResult, Screenshot, ScreenshotRecognizer } from './recognizer';

export function anthropicRecognizer(client: Anthropic, model: string): ScreenshotRecognizer {
  return {
    async recognize(screenshot: Screenshot): Promise<RecognitionResult> {
      const response = await client.messages.create({
        model,
        max_tokens: 16000,
        system: instructions,
        output_config: { format: zodOutputFormat(answerFormat) },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: screenshot.contentType,
                  data: Buffer.from(screenshot.bytes).toString('base64'),
                },
              },
              { type: 'text', text: request },
            ],
          },
        ],
      });
      if (response.stop_reason !== 'end_turn') {
        throw new Error(`The model stopped with ${response.stop_reason}`);
      }
      return readAnswer(response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''));
    },
  };
}

// Only whether the call succeeds matters, so the answer is kept short.
export async function probeAnthropic(client: Anthropic, model: string) {
  await client.messages.create({
    model,
    max_tokens: 16,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: probeImage } },
          { type: 'text', text: probeRequest },
        ],
      },
    ],
  });
}
