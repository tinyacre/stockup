import { describe, expect, test } from 'bun:test';
import { findLastYearPromotionLowest, isMonthDay, matchPromotion, promotionYear } from '../src';
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

describe('findLastYearPromotionLowest', () => {
  const newYear = { id: 'new-year', name: '年货节', startsOn: '12-20', endsOn: '01-25' };
  const lowests = [
    { promotionId: 'new-year', year: 2024, lowestUnitPrice: 300 },
    { promotionId: 'new-year', year: 2025, lowestUnitPrice: 250 },
    { promotionId: '618', year: 2025, lowestUnitPrice: 200 },
  ];

  test("is the lowest of the promotion's previous occurrence", () => {
    expect(findLastYearPromotionLowest('2026-12-25', newYear, lowests)).toBe(250);
  });

  test('counts January days of a range across the new year towards the occurrence that started before', () => {
    expect(findLastYearPromotionLowest('2026-01-10', newYear, lowests)).toBe(300);
  });

  test('is null when the previous occurrence has no records', () => {
    expect(findLastYearPromotionLowest('2027-12-25', newYear, lowests)).toBeNull();
  });
});
