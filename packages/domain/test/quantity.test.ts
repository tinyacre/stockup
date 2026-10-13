import { describe, expect, test } from 'bun:test';
import { parseQuantity } from '../src';
import { quantityFixtures } from '../fixtures';

describe('parseQuantity', () => {
  for (const f of quantityFixtures) {
    test(f.name, () => {
      expect(parseQuantity(f.text)).toBe(f.expected);
    });
  }
});
