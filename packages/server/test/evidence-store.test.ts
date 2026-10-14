import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localEvidenceStore } from '../src/evidence-store';

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'stockup-evidence-'));
}

describe('local evidence store', () => {
  test('stores, reads back and deletes by key', async () => {
    const dir = tempDir();
    const store = localEvidenceStore(dir);
    const data = new Uint8Array([1, 2, 3]);

    await store.put('abc-123', data);
    expect(existsSync(path.join(dir, 'abc-123'))).toBe(true);
    expect(await store.get('abc-123')).toEqual(data);

    await store.delete('abc-123');
    expect(await store.get('abc-123')).toBeNull();
    expect(existsSync(path.join(dir, 'abc-123'))).toBe(false);
  });

  test('reads a missing key as null and deletes it without error', async () => {
    const store = localEvidenceStore(tempDir());
    expect(await store.get('missing')).toBeNull();
    await store.delete('missing');
  });

  test('creates the directory on first write', async () => {
    const dir = path.join(tempDir(), 'nested', 'evidence');
    const store = localEvidenceStore(dir);
    await store.put('key', new Uint8Array([9]));
    expect(await store.get('key')).toEqual(new Uint8Array([9]));
  });

  test('rejects keys that could leave the directory', async () => {
    const store = localEvidenceStore(tempDir());
    for (const key of ['../escape', 'a/b', '', '.']) {
      expect(store.put(key, new Uint8Array([1]))).rejects.toThrow(RangeError);
      expect(store.get(key)).rejects.toThrow(RangeError);
      expect(store.delete(key)).rejects.toThrow(RangeError);
    }
  });
});
