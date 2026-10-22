import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localEvidenceStore, probeEvidenceStore } from '../src/evidence-store';
import { openS3EvidenceStore, s3EvidenceStore } from '../src/s3-evidence-store';
import { evidenceStoreContract } from './support/evidence-store-contract';
import { testS3Config } from './support/s3';

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'stockup-evidence-'));
}

evidenceStoreContract('local', () => localEvidenceStore(tempDir()));
evidenceStoreContract('S3', () => s3EvidenceStore(testS3Config()));

describe('local evidence store', () => {
  test('keeps each piece as a file named by its key', async () => {
    const dir = tempDir();
    const store = localEvidenceStore(dir);
    await store.put('abc-123', new Uint8Array([1]));
    expect(existsSync(path.join(dir, 'abc-123'))).toBe(true);
    await store.delete('abc-123');
    expect(existsSync(path.join(dir, 'abc-123'))).toBe(false);
  });

  test('creates the directory on first write', async () => {
    const dir = path.join(tempDir(), 'nested', 'evidence');
    const store = localEvidenceStore(dir);
    await store.put('key', new Uint8Array([9]));
    expect(await store.get('key')).toEqual(new Uint8Array([9]));
  });

  test('passes the probe and leaves nothing behind', async () => {
    const dir = tempDir();
    await probeEvidenceStore(localEvidenceStore(dir));
    expect(await Array.fromAsync(new Bun.Glob('*').scan(dir))).toEqual([]);
  });
});

describe('S3 evidence store', () => {
  test('tells whether a key holds an object', async () => {
    const store = s3EvidenceStore(testS3Config());
    const key = crypto.randomUUID();
    expect(await store.has(key)).toBe(false);
    await store.put(key, new Uint8Array([1]));
    expect(await store.has(key)).toBe(true);
    await store.delete(key);
    expect(await store.has(key)).toBe(false);
  });

  test('addresses an IP-address endpoint by path even when virtual-hosted style is configured', async () => {
    const store = s3EvidenceStore(testS3Config({ endpoint: 'http://127.0.0.1:59000', pathStyle: false }));
    const key = crypto.randomUUID();
    await store.put(key, new Uint8Array([7]));
    expect(await store.get(key)).toEqual(new Uint8Array([7]));
    await store.delete(key);
  });

  test('opens once the bucket accepts a probe object', async () => {
    const store = await openS3EvidenceStore(testS3Config());
    await expect(store.get(crypto.randomUUID())).resolves.toBeNull();
  });

  test('refuses to open on a bucket that does not exist', async () => {
    const config = testS3Config({ bucket: `stockup-missing-${crypto.randomUUID().slice(0, 8)}` });
    await expect(openS3EvidenceStore(config)).rejects.toThrow(
      `S3 bucket ${config.bucket} at ${config.endpoint} cannot be written: S3 PUT stockup-probe-`,
    );
    await expect(openS3EvidenceStore(config)).rejects.toThrow('NoSuchBucket');
  });

  test('refuses to open with credentials the bucket does not know', async () => {
    await expect(openS3EvidenceStore(testS3Config({ accessKeyId: 'not-a-key' }))).rejects.toThrow('InvalidAccessKeyId');
  });
});
