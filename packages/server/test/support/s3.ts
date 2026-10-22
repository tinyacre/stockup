import type { S3Config } from '../../src/config';

// Defaults match the RustFS service in docker-compose.dev.yml.
export function testS3Config(overrides: Partial<S3Config> = {}): S3Config {
  const env = process.env;
  return {
    endpoint: env.STOCKUP_TEST_S3_ENDPOINT || 'http://127.0.0.1:59000',
    region: env.STOCKUP_TEST_S3_REGION || 'us-east-1',
    bucket: env.STOCKUP_TEST_S3_BUCKET || 'stockup-test',
    accessKeyId: env.STOCKUP_TEST_S3_ACCESS_KEY_ID || 'stockup',
    secretAccessKey: env.STOCKUP_TEST_S3_SECRET_ACCESS_KEY || 'stockup-secret',
    pathStyle: ['1', 'true', 'yes'].includes((env.STOCKUP_TEST_S3_PATH_STYLE || 'true').toLowerCase()),
    ...overrides,
  };
}
