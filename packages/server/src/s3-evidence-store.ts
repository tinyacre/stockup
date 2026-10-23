import { isIP } from 'node:net';
import type { S3Config } from './config';
import { checkEvidenceKey, probeEvidenceStore, type EvidenceStore } from './evidence-store';

export type S3EvidenceStore = EvidenceStore & { has(key: string): Promise<boolean> };

const probeTimeoutMs = 30_000;

function s3Failure(operation: string, key: string, error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`S3 ${operation} ${key}: ${typeof code === 'string' ? `${code}: ` : ''}${message}`, { cause: error });
}

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Mirrors the AWS SDK's virtual-hostable bucket rule: a dotted bucket name would add subdomain levels that a
// wildcard TLS certificate does not cover, so it only goes into the host over plain http.
function bucketFitsHost(bucket: string, protocol: string) {
  const labels = protocol === 'https:' ? [bucket] : bucket.split('.');
  return bucket.length >= 3 && bucket.length <= 63 && isIP(bucket) === 0 && labels.every((label) => dnsLabel.test(label));
}

export function s3EvidenceStore(config: S3Config): S3EvidenceStore {
  const endpoint = new URL(config.endpoint);
  // An IP address cannot carry the bucket as a subdomain.
  const virtualHostedStyle =
    !config.pathStyle &&
    isIP(endpoint.hostname.replace(/^\[|\]$/g, '')) === 0 &&
    bucketFitsHost(config.bucket, endpoint.protocol);
  // Bun sends virtual-hosted requests to the endpoint host as given, so the bucket subdomain has to be part of it.
  if (virtualHostedStyle) endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  const client = new Bun.S3Client({
    endpoint: endpoint.origin,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    virtualHostedStyle,
  });

  const run = async <T>(operation: string, key: string, call: () => Promise<T>) => {
    checkEvidenceKey(key);
    try {
      return await call();
    } catch (error) {
      throw s3Failure(operation, key, error);
    }
  };

  return {
    async put(key, data) {
      await run('PUT', key, () => client.write(key, data, { type: 'application/octet-stream' }));
    },
    async get(key) {
      checkEvidenceKey(key);
      try {
        return await client.file(key).bytes();
      } catch (error) {
        if ((error as { code?: unknown }).code === 'NoSuchKey') return null;
        throw s3Failure('GET', key, error);
      }
    },
    async delete(key) {
      await run('DELETE', key, () => client.delete(key));
    },
    async has(key) {
      return run('HEAD', key, () => client.exists(key));
    },
  };
}

// Probes before handing the store out, so a wrong endpoint, bucket or credential fails the boot
// rather than the first upload.
export async function openS3EvidenceStore(config: S3Config): Promise<S3EvidenceStore> {
  const store = s3EvidenceStore(config);
  const name = `S3 bucket ${config.bucket} at ${config.endpoint}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} did not answer within ${probeTimeoutMs / 1000} s`)), probeTimeoutMs);
  });
  try {
    await Promise.race([probeEvidenceStore(store, name), timeout]);
  } finally {
    clearTimeout(timer);
  }
  return store;
}
