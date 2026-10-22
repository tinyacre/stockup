import path from 'node:path';

export interface Config {
  databaseUrl: string;
  authSecret: string;
  baseUrl: string;
  port: number;
  evidenceDir: string;
  webDir: string | undefined;
  // Set only when a proxy in front of the server overwrites this header with the client address.
  clientIpHeader: string | undefined;
  // Screenshot recognition is unavailable without an API key.
  recognizer: { apiKey: string; model: string } | undefined;
  // Evidence lives in the local directory without one.
  s3: S3Config | undefined;
  signup: 'open' | 'closed';
  // Email-based flows (signup, password reset, changing email) are unavailable without one.
  smtp: SmtpConfig | undefined;
}

export interface SmtpConfig {
  host: string;
  port: number;
  // Without one the server sends without authenticating.
  username: string | undefined;
  password: string | undefined;
  from: string;
  tls: SmtpTls;
}

const smtpTlsModes = ['starttls', 'implicit', 'none'] as const;
export type SmtpTls = (typeof smtpTlsModes)[number];

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
}

type Env = Record<string, string | undefined>;

// Names every required variable of a partly configured group, so one restart fixes them all.
function missingVars(env: Env, names: string[]): string[] {
  return names.filter((name) => !env[name]);
}

const s3Vars = [
  'STOCKUP_S3_ENDPOINT',
  'STOCKUP_S3_REGION',
  'STOCKUP_S3_BUCKET',
  'STOCKUP_S3_ACCESS_KEY_ID',
  'STOCKUP_S3_SECRET_ACCESS_KEY',
  'STOCKUP_S3_PATH_STYLE',
];

function loadS3Config(env: Env): S3Config | undefined {
  if (missingVars(env, s3Vars).length === s3Vars.length) return undefined;
  const missing = missingVars(env, ['STOCKUP_S3_ENDPOINT', 'STOCKUP_S3_BUCKET', 'STOCKUP_S3_ACCESS_KEY_ID', 'STOCKUP_S3_SECRET_ACCESS_KEY']);
  if (missing.length > 0) throw new Error(`S3 evidence storage is configured but ${missing.join(', ')} not set`);

  const endpoint = env.STOCKUP_S3_ENDPOINT!;
  const url = URL.canParse(endpoint) ? new URL(endpoint) : undefined;
  // The client appends the bucket and key to the endpoint, so anything beyond the origin would be lost or misread.
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`STOCKUP_S3_ENDPOINT must be http(s)://host[:port] with no path, got "${endpoint}"`);
  }

  const pathStyle = env.STOCKUP_S3_PATH_STYLE?.toLowerCase() ?? '';
  if (!['1', 'true', 'yes', '0', 'false', 'no', ''].includes(pathStyle)) {
    throw new Error(`STOCKUP_S3_PATH_STYLE must be true or false, got "${env.STOCKUP_S3_PATH_STYLE}"`);
  }

  return {
    endpoint: url.origin,
    region: env.STOCKUP_S3_REGION || 'us-east-1',
    bucket: env.STOCKUP_S3_BUCKET!,
    accessKeyId: env.STOCKUP_S3_ACCESS_KEY_ID!,
    secretAccessKey: env.STOCKUP_S3_SECRET_ACCESS_KEY!,
    pathStyle: ['1', 'true', 'yes'].includes(pathStyle),
  };
}

const smtpVars = [
  'STOCKUP_SMTP_HOST',
  'STOCKUP_SMTP_PORT',
  'STOCKUP_SMTP_USERNAME',
  'STOCKUP_SMTP_PASSWORD',
  'STOCKUP_SMTP_FROM',
  'STOCKUP_SMTP_TLS',
];

const defaultSmtpPorts: Record<SmtpTls, number> = { implicit: 465, none: 25, starttls: 587 };

// An RFC 5322 mailbox: a bare address, or a display name followed by the address in angle brackets.
const mailbox = /^(?:[^<>]*<\s*([^<>\s]+)\s*>|([^<>\s]+))$/;
const address = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function loadSmtpConfig(env: Env): SmtpConfig | undefined {
  if (missingVars(env, smtpVars).length === smtpVars.length) return undefined;
  const missing = missingVars(env, ['STOCKUP_SMTP_HOST', 'STOCKUP_SMTP_FROM']);
  if (missing.length > 0) throw new Error(`SMTP is configured but ${missing.join(', ')} not set`);

  const tls = (env.STOCKUP_SMTP_TLS || 'starttls').toLowerCase();
  if (!smtpTlsModes.includes(tls as SmtpTls)) {
    throw new Error(`STOCKUP_SMTP_TLS must be starttls, implicit or none, got "${env.STOCKUP_SMTP_TLS}"`);
  }

  const port = env.STOCKUP_SMTP_PORT ? Number(env.STOCKUP_SMTP_PORT) : defaultSmtpPorts[tls as SmtpTls];
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`STOCKUP_SMTP_PORT must be a port number, got "${env.STOCKUP_SMTP_PORT}"`);
  }

  if (env.STOCKUP_SMTP_PASSWORD && !env.STOCKUP_SMTP_USERNAME) {
    throw new Error('STOCKUP_SMTP_PASSWORD is set but STOCKUP_SMTP_USERNAME is not');
  }

  const from = env.STOCKUP_SMTP_FROM!.trim();
  const [, named, bare] = mailbox.exec(from) ?? [];
  if (!address.test(named ?? bare ?? '')) {
    throw new Error(`STOCKUP_SMTP_FROM "${env.STOCKUP_SMTP_FROM}" is not an email address`);
  }

  return {
    host: env.STOCKUP_SMTP_HOST!,
    port,
    username: env.STOCKUP_SMTP_USERNAME || undefined,
    password: env.STOCKUP_SMTP_PASSWORD || undefined,
    from,
    tls: tls as SmtpTls,
  };
}

// Signup stays closed unless asked for, so a public instance never opens to everyone by accident; it also
// needs SMTP, since the emailed code is what proves a new account's address.
function loadSignup(env: Env, smtp: SmtpConfig | undefined): Config['signup'] {
  const signup = env.STOCKUP_SIGNUP?.toLowerCase() || 'closed';
  if (signup !== 'open' && signup !== 'closed') {
    throw new Error(`STOCKUP_SIGNUP must be open or closed, got "${env.STOCKUP_SIGNUP}"`);
  }
  if (signup === 'open' && !smtp) {
    throw new Error('STOCKUP_SIGNUP=open requires SMTP: set STOCKUP_SMTP_HOST and STOCKUP_SMTP_FROM');
  }
  return signup;
}

export function loadConfig(env: Env): Config {
  const databaseUrl = env.STOCKUP_DATABASE_URL;
  if (!databaseUrl) throw new Error('STOCKUP_DATABASE_URL is required');

  const authSecret = env.STOCKUP_AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    throw new Error('STOCKUP_AUTH_SECRET is required and must be at least 32 characters');
  }

  // The issuer of OAuth tokens and the identifier of the MCP resource, so it cannot be derived per request.
  const baseUrl = env.STOCKUP_BASE_URL;
  if (!baseUrl || !URL.canParse(baseUrl)) {
    throw new Error('STOCKUP_BASE_URL is required and must be the public URL members open, e.g. https://stockup.example.com');
  }

  const port = Number(env.STOCKUP_PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`STOCKUP_PORT must be a port number, got "${env.STOCKUP_PORT}"`);
  }

  const smtp = loadSmtpConfig(env);

  return {
    databaseUrl,
    authSecret,
    baseUrl,
    port,
    evidenceDir: path.resolve(env.STOCKUP_EVIDENCE_DIR || 'data/evidence'),
    webDir: env.STOCKUP_WEB_DIR ? path.resolve(env.STOCKUP_WEB_DIR) : undefined,
    clientIpHeader: env.STOCKUP_CLIENT_IP_HEADER?.toLowerCase() || undefined,
    recognizer: env.STOCKUP_ANTHROPIC_API_KEY
      ? { apiKey: env.STOCKUP_ANTHROPIC_API_KEY, model: env.STOCKUP_ANTHROPIC_MODEL || 'claude-haiku-5-5' }
      : undefined,
    s3: loadS3Config(env),
    signup: loadSignup(env, smtp),
    smtp,
  };
}
