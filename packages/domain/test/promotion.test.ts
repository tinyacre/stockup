import { describe, expect, test } from 'bun:test';
import { matchPromotion } from '../src';
import { promotionFixtures } from '../fixtures';
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
