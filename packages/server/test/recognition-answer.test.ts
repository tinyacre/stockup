import { describe, expect, test } from 'bun:test';
import { readAnswer } from '../src/recognition-answer';

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

describe('readAnswer', () => {
  test('reads prices given in yuan as cents, leaving out discount names the page did not give', () => {
    expect(readAnswer(JSON.stringify(answer))).toEqual({
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
  });

  test('rounds prices to whole cents', () => {
    const item = { name: '牛奶', sizeText: '250ml', quantity: 1, listPrice: 4.199999, discounts: [] };
    expect(readAnswer(JSON.stringify({ ...answer, items: [item], orderDiscounts: [] })).items[0]!.listPrice).toBe(420);
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
  ])('rejects %s', (_label, text) => {
    expect(() => readAnswer(text)).toThrow();
  });
});
