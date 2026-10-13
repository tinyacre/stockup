import { describe, expect, test } from 'bun:test';
import { isMonthDay, matchPromotion, promotionYear } from '../src';
import { monthDayFixtures, promotionFixtures, promotionYearFixtures } from '../fixtures';
import { expectError } from './expect-error';

describe('matchPromotion', () => {
  for (const f of promotionFixtures) {
    test(f.name, () => {
      const run = () => matchPromotion(f.date, f.promotions);
      if ('error' in f) return expectError(run, f.error);
      expect(run()?.name ?? null).toBe(f.expected);
    });
  }
});

describe('promotionYear', () => {
  for (const f of promotionYearFixtures) {
    test(f.name, () => {
      const run = () => promotionYear(f.date, f.promotion);
      if ('error' in f) return expectError(run, f.error);
      expect(run()).toBe(f.expected);
    });
  }
});

describe('isMonthDay', () => {
  for (const f of monthDayFixtures) {
    test(f.name, () => expect(isMonthDay(f.text)).toBe(f.expected));
  }
});
