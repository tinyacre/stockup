import path from 'node:path';
import type { ErrorEvent, EventHint, StackFrame } from '@sentry/bun';
import { DrizzleQueryError } from 'drizzle-orm';

// The server's own failures, sent to the operator's GlitchTip (STOCKUP_SERVER_GLITCHTIP_DSN). What an event may
// carry is fixed by tinyacre/telemetry's data boundary: every event is rebuilt from the route template or task
// name, the method and status, the release, the error message and its stack. Headers, query, body, user and
// household never reach it.
export interface ErrorReporter {
  // A 5xx answered on `route`, the matched route template.
  request(route: string, method: string, status: number, error: unknown): void;
  task(name: string, error: unknown): void;
  flush(timeoutMs: number): Promise<void>;
}

// Frames are named from the repository root, so a stack reads the same from a checkout and from the image.
const root = path.resolve(import.meta.dir, '../../..');

export function errorReporter({
  dsn,
  release,
  fetch = globalThis.fetch,
}: {
  dsn: string | undefined;
  release: string;
  fetch?: typeof globalThis.fetch;
}): ErrorReporter | undefined {
  if (!dsn) return undefined;
  // Only a server that reports loads the SDK. The client is built without the SDK's global init, so none of its
  // default integrations (breadcrumbs, request data, context, uncaught exception handlers) is installed.
  const loading = import('@sentry/bun').then((Sentry) => {
    const client = new Sentry.BunClient({
      dsn,
      release,
      integrations: [],
      stackParser: Sentry.defaultStackParser,
      sendClientReports: false,
      maxBreadcrumbs: 0,
      beforeSend: withinDataBoundary,
      transport: (options) =>
        Sentry.createTransport(options, async ({ body }) => {
          const res = await fetch(options.url, {
            method: 'POST',
            body: body as RequestInit['body'],
            headers: options.headers,
          });
          return {
            statusCode: res.status,
            headers: {
              'retry-after': res.headers.get('retry-after'),
              'x-sentry-rate-limits': res.headers.get('x-sentry-rate-limits'),
            },
          };
        }),
    });
    // The constructor records the SDK's name, version and integrations, which the envelope adds to each event after
    // beforeSend has run.
    delete client.getOptions()._metadata;
    client.init();
    return { Sentry, client };
  });

  function capture(transaction: string, tags: Record<string, string>, error: unknown) {
    void loading.then(({ Sentry, client }) => {
      const scope = new Sentry.Scope();
      scope.setTransactionName(transaction);
      scope.setTags(tags);
      client.captureException(error, { originalException: error }, scope);
    });
  }

  return {
    request(route, method, status, error) {
      capture(`${method} ${route}`, { 'http.method': method, 'http.status_code': String(status) }, error);
    },
    task(name, error) {
      capture(`task ${name}`, { task: name }, error);
    },
    async flush(timeoutMs) {
      await (await loading).client.flush(timeoutMs);
    },
  };
}

// Runs on the event the SDK has finished assembling, which by then holds the host name, the environment, the
// runtime and trace contexts, and returns a new one with only what the data boundary keeps.
function withinDataBoundary(event: ErrorEvent, { originalException }: EventHint): ErrorEvent {
  const { event_id, timestamp, level, platform, release, transaction } = event;
  const tags = Object.fromEntries(Object.entries(event.tags ?? {}).filter(([key]) => keptTags.has(key)));
  return {
    type: undefined,
    event_id,
    timestamp,
    level,
    platform,
    release,
    transaction,
    tags,
    exception: {
      values: event.exception?.values?.map(({ type, value, stacktrace }) => ({
        type,
        value: reportedMessage(originalException, value),
        stacktrace: stacktrace && { frames: stacktrace.frames?.map(keptFrame) },
      })),
    },
  };
}

const keptTags = new Set(['http.method', 'http.status_code', 'task']);

function keptFrame({ function: fn, filename, lineno, colno, in_app }: StackFrame): StackFrame {
  return { function: fn, filename: filename && reportedFileName(filename), lineno, colno, in_app };
}

// A path outside the repository names a directory of the host, such as a home directory holding a package cache.
function reportedFileName(file: string) {
  if (!path.isAbsolute(file)) return file;
  return file.startsWith(`${root}/`) ? path.relative(root, file) : path.basename(file);
}

// A failed query's message lists its parameters, which hold what members entered, and the database's own message
// can quote a value too; the SQL with its placeholders and the SQLSTATE say what failed without them.
function reportedMessage(error: unknown, value: string | undefined) {
  if (error instanceof DrizzleQueryError) {
    const code = (error.cause as { code?: unknown } | undefined)?.code;
    return `Failed query: ${error.query}${typeof code === 'string' ? ` (SQLSTATE ${code})` : ''}`;
  }
  return value === undefined ? undefined : scrub(value);
}

// Messages interpolate ids only; this is the backstop for one that breaks the rule.
const emailShaped = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function scrub(message: string) {
  return message.replace(emailShaped, '[email]');
}
