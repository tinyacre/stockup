import path from 'node:path';
import type { ErrorEvent, StackFrame } from '@sentry/bun';

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
      beforeSend: whitelist,
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
    client.init();
    return { Sentry, client };
  });

  function capture(transaction: string, tags: Record<string, string>, error: unknown) {
    void loading.then(({ Sentry, client }) => {
      const scope = new Sentry.Scope();
      scope.setTransactionName(transaction);
      scope.setTags(tags);
      client.captureException(error, undefined, scope);
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
function whitelist(event: ErrorEvent): ErrorEvent {
  const { event_id, timestamp, level, platform, release, transaction, tags } = event;
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
        value: value === undefined ? undefined : scrub(value),
        stacktrace: stacktrace && { frames: stacktrace.frames?.map(keptFrame) },
      })),
    },
  };
}

function keptFrame({ function: fn, filename, lineno, colno, in_app }: StackFrame): StackFrame {
  const inRepository = filename?.startsWith(`${root}/`);
  return { function: fn, filename: inRepository ? path.relative(root, filename!) : filename, lineno, colno, in_app };
}

// Messages interpolate ids only; this is the backstop for one that breaks the rule.
const emailShaped = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function scrub(message: string) {
  return message.replace(emailShaped, '[email]');
}
