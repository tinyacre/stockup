import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { answerFormat, instructions, probeImage, probeRequest, readAnswer, request } from './recognition-answer';
import type { RecognitionResult, Screenshot, ScreenshotRecognizer } from './recognizer';

// Speaks Chat Completions rather than the Responses API, since that is what OpenAI-compatible services implement.
export function openaiRecognizer(client: OpenAI, model: string): ScreenshotRecognizer {
  return {
    async recognize(screenshot: Screenshot): Promise<RecognitionResult> {
      const completion = await client.chat.completions.create({
        model,
        response_format: zodResponseFormat(answerFormat, 'recognition'),
        messages: [
          { role: 'system', content: instructions },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${screenshot.contentType};base64,${Buffer.from(screenshot.bytes).toString('base64')}`,
                },
              },
              { type: 'text', text: request },
            ],
          },
        ],
      });
      const choice = completion.choices[0];
      if (!choice) throw new Error('The model gave no answer');
      if (choice.message.refusal) throw new Error(`The model refused: ${choice.message.refusal}`);
      if (choice.finish_reason !== 'stop') throw new Error(`The model stopped with ${choice.finish_reason}`);
      return readAnswer(choice.message.content ?? '');
    },
  };
}

// Only whether the call succeeds matters, but reasoning models spend part of the allowance before answering.
export async function probeOpenAI(client: OpenAI, model: string) {
  await client.chat.completions.create({
    model,
    max_completion_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${probeImage}` } },
          { type: 'text', text: probeRequest },
        ],
      },
    ],
  });
}
