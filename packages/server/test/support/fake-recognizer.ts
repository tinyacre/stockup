import type { RecognitionResult, Screenshot, ScreenshotRecognizer } from '../../src/recognizer';

export const fixedRecognition: RecognitionResult = {
  items: [
    { name: '得宝抽纸 M码', sizeText: '100抽', quantity: 18, listPrice: 9900, discounts: [{ amount: 1000, name: 'plus 券' }] },
    { name: '皇家猫粮', sizeText: '2kg', quantity: 1, listPrice: 25900, discounts: [] },
  ],
  orderDiscounts: [{ amount: 2000, name: '满 199 减 20' }],
  date: '2026-06-18',
  channel: '京东',
};

// Stands in for the multimodal model: answers with a fixed recognition, or whatever a test sets `respond` to.
export interface FakeRecognizer extends ScreenshotRecognizer {
  screenshots: Screenshot[];
  respond(screenshot: Screenshot): Promise<RecognitionResult>;
}

export function fakeRecognizer(): FakeRecognizer {
  const fake: FakeRecognizer = {
    screenshots: [],
    respond: async () => fixedRecognition,
    recognize(screenshot) {
      fake.screenshots.push(screenshot);
      return fake.respond(screenshot);
    },
  };
  return fake;
}
