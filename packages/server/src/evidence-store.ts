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

export function localEvidenceStore(dir: string): EvidenceStore {
  // Keys map straight to file names, so only plain names are accepted.
  const fileOf = async (key: string) => {
    if (!keyPattern.test(key)) throw new RangeError(`Invalid evidence key "${key}"`);
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
