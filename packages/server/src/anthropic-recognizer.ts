import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Discount } from '@stockup/domain';
import type { RecognitionResult, Screenshot, ScreenshotRecognizer } from './recognizer';

// Prices go to the model in yuan as the page prints them; asking for cents invites slips by a factor of 100.
const yuan = z.number();

const discount = z.object({
  amount: yuan.describe('Yuan taken off, as a positive number'),
  name: z.string().nullable().describe('The label the page gives it, such as "plus 券" or "满199减20"'),
});

const answerFormat = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe('The product name as the page writes it'),
        sizeText: z
          .string()
          .nullable()
          .describe('The pack size as written, such as "500g", "100抽×18包" or "2L"; null when the page shows none'),
        quantity: z.number().nullable().describe('How many were bought, a whole number; null when not shown'),
        listPrice: yuan
          .nullable()
          .describe('The total price in yuan for this line before any discount; null when not shown'),
        discounts: z.array(discount).describe('Discounts the page ties to this line alone'),
      }),
    )
    .describe('Every line of goods, in the order the page lists them'),
  orderDiscounts: z.array(discount).describe('Discounts on the whole order rather than any one line'),
  date: z.string().nullable().describe('The order or page date as YYYY-MM-DD; null when the page shows none'),
  channel: z
    .string()
    .nullable()
    .describe('The shop or platform the page belongs to, such as 京东 or 盒马; null when unclear'),
});

const instructions = `You read screenshots of Chinese shopping order pages and product pages and transcribe what was bought.
Transcribe only what the screenshot shows; leave a field null rather than guess it.
Give every price and discount in yuan, as a number. A line's list price is what that line costs before any discount: when the page shows a unit price and a quantity, multiply them.
Leave out shipping fees, and leave out lines that are not goods.`;

function cents(amount: number) {
  return Math.round(amount * 100);
}

// The output format keeps the model to the shape; these are the rules a shape cannot carry.
const answerSchema = answerFormat.extend({
  items: z.array(
    answerFormat.shape.items.element.extend({
      name: z.string().trim().min(1),
      quantity: z.number().int().positive().nullable(),
      listPrice: yuan.nonnegative().nullable(),
      discounts: z.array(discount.extend({ amount: yuan.positive() })),
    }),
  ),
  orderDiscounts: z.array(discount.extend({ amount: yuan.positive() })),
  date: z.iso.date().nullable(),
});

function toDiscounts(discounts: z.infer<typeof discount>[]): Discount[] {
  return discounts.map(({ amount, name }) => (name ? { amount: cents(amount), name } : { amount: cents(amount) }));
}

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
              { type: 'text', text: 'Transcribe the goods in this screenshot.' },
            ],
          },
        ],
      });
      if (response.stop_reason !== 'end_turn') {
        throw new Error(`The model stopped with ${response.stop_reason}`);
      }
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      const answer = answerSchema.parse(JSON.parse(text));
      return {
        items: answer.items.map((item) => ({
          name: item.name,
          sizeText: item.sizeText,
          quantity: item.quantity,
          listPrice: item.listPrice === null ? null : cents(item.listPrice),
          discounts: toDiscounts(item.discounts),
        })),
        orderDiscounts: toDiscounts(answer.orderDiscounts),
        date: answer.date,
        channel: answer.channel,
      };
    },
  };
}
