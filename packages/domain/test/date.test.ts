import { describe, expect, test } from 'bun:test';
import { localDate } from '../src';

describe('localDate', () => {
  test('gives the local calendar day with zero-padded month and day', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});
