import { describe, expect, test } from 'bun:test';
import { searchByName } from '../src/search';
import { searchFixtures } from '../fixtures';

describe('searchByName', () => {
  for (const f of searchFixtures) {
    test(f.name, () => {
      const items = f.names.map((name) => ({ name }));
      expect(searchByName(items, f.query).map((item) => item.name)).toEqual(f.expected);
    });
  }
});
