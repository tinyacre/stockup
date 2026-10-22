import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { S3Config } from '../src/config';
import { migrateEvidenceToS3 } from '../src/migrate-evidence';
import { s3EvidenceStore } from '../src/s3-evidence-store';
import { testS3Config } from './support/s3';

const script = path.join(import.meta.dir, '../src/migrate-evidence.ts');

function evidenceDir(files: Record<string, Uint8Array>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'stockup-migrate-'));
  for (const [name, data] of Object.entries(files)) writeFileSync(path.join(dir, name), data);
  return dir;
}

const randomKey = () => crypto.randomUUID();

function serverEnv(dir: string, s3?: S3Config) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    STOCKUP_DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
    STOCKUP_AUTH_SECRET: 'x'.repeat(32),
    STOCKUP_BASE_URL: 'https://stockup.example.com',
    STOCKUP_EVIDENCE_DIR: dir,
  };
  if (s3) {
    Object.assign(env, {
      STOCKUP_S3_ENDPOINT: s3.endpoint,
      STOCKUP_S3_REGION: s3.region,
      STOCKUP_S3_BUCKET: s3.bucket,
      STOCKUP_S3_ACCESS_KEY_ID: s3.accessKeyId,
      STOCKUP_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
      STOCKUP_S3_PATH_STYLE: String(s3.pathStyle),
    });
  }
  return env;
}

function runCommand(env: Record<string, string>) {
  const result = Bun.spawnSync(['bun', script], { env, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe('migrateEvidenceToS3', () => {
  test('uploads every local file under its own key and keeps the local copies', async () => {
    const [a, b] = [randomKey(), randomKey()];
    const dir = evidenceDir({ [a]: new Uint8Array([1, 2, 3]), [b]: new Uint8Array([4]) });
    const target = s3EvidenceStore(testS3Config());

    expect(await migrateEvidenceToS3(dir, target)).toEqual({ uploaded: 2, skipped: 0, failed: 0 });
    expect(await target.get(a)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await target.get(b)).toEqual(new Uint8Array([4]));
    expect(readdirSync(dir).sort()).toEqual([a, b].sort());
  });

  test('skips keys the bucket already holds, so it can run again', async () => {
    const [kept, fresh] = [randomKey(), randomKey()];
    const dir = evidenceDir({ [kept]: new Uint8Array([1]), [fresh]: new Uint8Array([2]) });
    const target = s3EvidenceStore(testS3Config());
    await target.put(kept, new Uint8Array([9]));

    expect(await migrateEvidenceToS3(dir, target)).toEqual({ uploaded: 1, skipped: 1, failed: 0 });
    expect(await target.get(kept)).toEqual(new Uint8Array([9]));
    expect(await migrateEvidenceToS3(dir, target)).toEqual({ uploaded: 0, skipped: 2, failed: 0 });
  });

  test('counts files it cannot upload and carries on with the rest', async () => {
    const good = randomKey();
    const dir = evidenceDir({ [good]: new Uint8Array([1]), 'not.a.key': new Uint8Array([2]) });
    const target = s3EvidenceStore(testS3Config());

    expect(await migrateEvidenceToS3(dir, target)).toEqual({ uploaded: 1, skipped: 0, failed: 1 });
    expect(await target.get(good)).toEqual(new Uint8Array([1]));
  });

  test('counts every file as failed when the bucket rejects them', async () => {
    const dir = evidenceDir({ [randomKey()]: new Uint8Array([1]) });
    const target = s3EvidenceStore(testS3Config({ bucket: `missing-${randomKey()}` }));

    expect(await migrateEvidenceToS3(dir, target)).toEqual({ uploaded: 0, skipped: 0, failed: 1 });
  });
});

describe('migrate-evidence command', () => {
  test('refuses to run without S3 configured', () => {
    const result = runCommand(serverEnv(evidenceDir({})));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('S3 evidence storage is not configured');
  });

  test('prints the counts and exits zero when everything made it', () => {
    const key = randomKey();
    const result = runCommand(serverEnv(evidenceDir({ [key]: new Uint8Array([1]) }), testS3Config()));
    expect(result.stdout).toContain('uploaded 1, skipped 0, failed 0');
    expect(result.exitCode).toBe(0);
  });

  test('exits non-zero when a file failed', () => {
    const result = runCommand(serverEnv(evidenceDir({ [randomKey()]: new Uint8Array([1]), 'not.a.key': new Uint8Array([2]) }), testS3Config()));
    expect(result.stdout).toContain('uploaded 1, skipped 0, failed 1');
    expect(result.stderr).toContain('not.a.key');
    expect(result.exitCode).toBe(1);
  });
});
