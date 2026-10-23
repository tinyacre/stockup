import { describe, expect, test } from 'bun:test';
import { isGroupIcon } from '../src';

describe('isGroupIcon', () => {
  test.each(['paw-print', 'shopping-basket', '🐱', '🧻', '👨‍👩‍👧', '🇨🇳', '❤️'])('accepts %s', (value) => {
    expect(isGroupIcon(value)).toBe(true);
  });

  test.each(['', 'folder', '🐱🐶', 'a', '猫', '1'])('rejects %p', (value) => {
    expect(isGroupIcon(value)).toBe(false);
  });
});
