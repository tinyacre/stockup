import { describe, expect, test } from 'bun:test';
import { convert, isUnit } from '../src';
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

describe('isUnit', () => {
  test('accepts every weight and volume unit', () => {
    for (const name of ['g', 'kg', '斤', '磅']) expect(isUnit({ dimension: 'weight', name })).toBe(true);
    for (const name of ['ml', 'L']) expect(isUnit({ dimension: 'volume', name })).toBe(true);
  });

  test('accepts a named count unit', () => {
    expect(isUnit({ dimension: 'count', name: '抽' })).toBe(true);
  });

  test('rejects a unit from another dimension', () => {
    expect(isUnit({ dimension: 'weight', name: 'ml' })).toBe(false);
    expect(isUnit({ dimension: 'volume', name: 'kg' })).toBe(false);
  });

  test('rejects an unknown dimension', () => {
    expect(isUnit({ dimension: 'length', name: 'm' })).toBe(false);
  });

  test('rejects a blank or padded count unit name', () => {
    expect(isUnit({ dimension: 'count', name: '' })).toBe(false);
    expect(isUnit({ dimension: 'count', name: '  ' })).toBe(false);
    expect(isUnit({ dimension: 'count', name: ' 抽' })).toBe(false);
  });

  test('rejects a count unit named after a weight or volume unit', () => {
    expect(isUnit({ dimension: 'count', name: 'kg' })).toBe(false);
    expect(isUnit({ dimension: 'count', name: 'L' })).toBe(false);
  });

  test('rejects a count unit named after a weight or volume unit in another letter case', () => {
    for (const name of ['KG', 'Kg', 'G', 'l', 'ML']) expect(isUnit({ dimension: 'count', name })).toBe(false);
  });
});
