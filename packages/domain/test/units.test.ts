import { describe, expect, test } from 'bun:test';
import { convert } from '../src';
import { unitFixtures } from '../fixtures';
import { expectError } from './expect-error';

describe('convert', () => {
  for (const f of unitFixtures) {
    test(f.name, () => {
      const run = () => convert(f.amount, f.from, f.to);
      if ('error' in f) expectError(run, f.error);
      else expect(run()).toBeCloseTo(f.expected, 6);
    });
  }
});
