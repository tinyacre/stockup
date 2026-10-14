import { describe, expect, test } from 'bun:test';
import { parseSize } from '../src';
import { sizeFixtures } from '../fixtures';

describe('parseSize', () => {
  for (const f of sizeFixtures) {
    test(f.name, () => {
      expect(parseSize(f.text)).toEqual(f.expected);
    });
  }
});
