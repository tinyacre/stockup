import { readdir } from 'node:fs/promises';
import { loadConfig } from './config';
import { localEvidenceStore } from './evidence-store';
import { openS3EvidenceStore, type S3EvidenceStore } from './s3-evidence-store';

const parallelUploads = 8;

// Leaves the local files in place, so the instance can fall back to the directory until the bucket is trusted.
// Keys already in the bucket are taken as migrated, which makes a rerun after a partial failure cheap.
export async function migrateEvidenceToS3(dir: string, target: S3EvidenceStore) {
  const source = localEvidenceStore(dir);
  const keys = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const counts = { uploaded: 0, skipped: 0, failed: 0 };

  const migrate = async (key: string) => {
    try {
      if (await target.has(key)) {
        counts.skipped++;
        return;
      }
      const data = await source.get(key);
      if (!data) throw new Error('the file disappeared while migrating');
      await target.put(key, data);
      counts.uploaded++;
    } catch (error) {
      counts.failed++;
      console.error(`${key}: ${error instanceof Error ? error.message : error}`);
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < keys.length) await migrate(keys[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(parallelUploads, keys.length) }, worker));
  return counts;
}

if (import.meta.main) {
  const config = loadConfig(process.env);
  if (!config.s3) {
    console.error('S3 evidence storage is not configured: set the STOCKUP_S3_* variables the server will use.');
    process.exit(1);
  }
  const target = await openS3EvidenceStore(config.s3);
  console.log(`Copying evidence from ${config.evidenceDir} to S3 bucket ${config.s3.bucket} at ${config.s3.endpoint}`);
  const { uploaded, skipped, failed } = await migrateEvidenceToS3(config.evidenceDir, target);
  console.log(`uploaded ${uploaded}, skipped ${skipped}, failed ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}
