import { describe, expect, test } from 'bun:test';
import type { EvidenceStore } from '../../src/evidence-store';

// Keys are random because S3 suites share one bucket across runs and worktrees.
function randomKey() {
  return crypto.randomUUID();
}

// The behavior evidence code relies on, whichever store holds the files.
export function evidenceStoreContract(name: string, makeStore: () => EvidenceStore) {
  describe(`${name} evidence store`, () => {
    test('stores, reads back and deletes by key', async () => {
      const store = makeStore();
      const key = randomKey();
      const data = new Uint8Array([1, 2, 3]);

      await store.put(key, data);
      expect(await store.get(key)).toEqual(data);

      await store.delete(key);
      expect(await store.get(key)).toBeNull();
    });

    test('replaces what is stored under a key', async () => {
      const store = makeStore();
      const key = randomKey();
      await store.put(key, new Uint8Array([1, 2, 3]));
      await store.put(key, new Uint8Array([4]));
      expect(await store.get(key)).toEqual(new Uint8Array([4]));
      await store.delete(key);
    });

    test('keeps every byte value intact', async () => {
      const store = makeStore();
      const key = randomKey();
      const data = Uint8Array.from({ length: 256 }, (_, i) => i);
      await store.put(key, data);
      expect(await store.get(key)).toEqual(data);
      await store.delete(key);
    });

    test('reads a missing key as null and deletes it without error', async () => {
      const store = makeStore();
      const key = randomKey();
      expect(await store.get(key)).toBeNull();
      await store.delete(key);
    });

    test('rejects keys outside the plain-name rule', async () => {
      const store = makeStore();
      for (const key of ['../escape', 'a/b', '', '.']) {
        await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow(RangeError);
        await expect(store.get(key)).rejects.toThrow(RangeError);
        await expect(store.delete(key)).rejects.toThrow(RangeError);
      }
    });
  });
}
