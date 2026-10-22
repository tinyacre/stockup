import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Where Evidence files live, addressed by opaque keys; the database keeps what each key belongs to.
export interface EvidenceStore {
  put(key: string, data: Uint8Array): Promise<void>;
  // Null when nothing is stored under the key.
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
  // Succeeds when nothing is stored under the key.
  delete(key: string): Promise<void>;
}

const keyPattern = /^[A-Za-z0-9_-]+$/;

// Keys map straight to file names in the local store, so every store accepts only plain names
// and evidence can move between stores under the same keys.
export function checkEvidenceKey(key: string) {
  if (!keyPattern.test(key)) throw new RangeError(`Invalid evidence key "${key}"`);
}

export function localEvidenceStore(dir: string): EvidenceStore {
  const fileOf = async (key: string) => {
    checkEvidenceKey(key);
    return path.join(dir, key);
  };

  return {
    async put(key, data) {
      const file = await fileOf(key);
      await mkdir(dir, { recursive: true });
      await writeFile(file, data);
    },
    async get(key) {
      const file = await fileOf(key);
      try {
        const buffer = await readFile(file);
        return new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(await fileOf(key), { force: true });
    },
  };
}

// A store that cannot write, read back and delete a throwaway object rejects with which of the three failed.
export async function probeEvidenceStore(store: EvidenceStore, name = 'Evidence store') {
  const key = `stockup-probe-${crypto.randomUUID().replaceAll('-', '')}`;
  const data = new TextEncoder().encode(key);
  const step = async <T>(failure: string, run: () => Promise<T>) => {
    try {
      return await run();
    } catch (error) {
      throw new Error(`${name} cannot be ${failure}: ${error instanceof Error ? error.message : error}`, { cause: error });
    }
  };

  await step('written', () => store.put(key, data));
  const read = await step('read', () => store.get(key));
  if (!read || !Buffer.from(read).equals(data)) throw new Error(`${name} cannot be read: the probe object came back different`);
  await step('deleted', () => store.delete(key));
}
