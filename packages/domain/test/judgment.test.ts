import { describe, expect, test } from 'bun:test';
import { judge } from '../src';
import { judgmentFixtures } from '../fixtures';
import { expectError } from './expect-error';

describe('judge', () => {
  for (const f of judgmentFixtures) {
    test(f.name, () => {
      const run = () => judge(f.input);
      if ('error' in f) return expectError(run, f.error);
      const judgment = run();
      expect(judgment.verdict).toBe(f.expected.verdict);
      for (const key of ['stockLineGap', 'lowestGap', 'lastYearPromotionGap'] as const) {
        const expected = f.expected[key];
        if (expected === null) expect(judgment[key]).toBeNull();
        else expect(judgment[key]).toBeCloseTo(expected, 9);
      }
    });
  }
});
