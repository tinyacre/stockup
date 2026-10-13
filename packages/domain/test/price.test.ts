import { describe, expect, test } from 'bun:test';
import { calculatePrice } from '../src';
import { priceFixtures } from '../fixtures';
import { expectError } from './expect-error';

describe('calculatePrice', () => {
  for (const f of priceFixtures) {
    test(f.name, () => {
      const run = () => calculatePrice(f.input);
      if ('error' in f) return expectError(run, f.error);
      const price = run();
      expect(price.netPrice).toBe(f.expected.netPrice);
      expect(price.unitPrice).toBeCloseTo(f.expected.unitPrice, 6);
    });
  }
});
