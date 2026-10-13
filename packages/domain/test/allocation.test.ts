import { describe, expect, test } from 'bun:test';
import { allocateDiscount } from '../src';
import { allocationFixtures } from '../fixtures';
import { expectError } from './expect-error';

describe('allocateDiscount', () => {
  for (const f of allocationFixtures) {
    test(f.name, () => {
      const run = () => allocateDiscount(f.total, f.listPrices);
      if ('error' in f) return expectError(run, f.error);
      expect(run()).toEqual(f.expected);
    });
  }
});
