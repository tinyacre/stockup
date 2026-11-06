// Stands in for GlitchTip's envelope endpoint: keeps every event the reporter delivers, as it went over the wire.
export function fakeGlitchtip() {
  const events: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    const body = typeof init?.body === 'string' ? init.body : new TextDecoder().decode(init?.body as Uint8Array);
    // An envelope is a header line followed by pairs of an item header line and its payload line.
    const [, ...items] = body.split('\n').filter(Boolean);
    for (let i = 0; i < items.length; i += 2) {
      if (JSON.parse(items[i]!).type === 'event') events.push(JSON.parse(items[i + 1]!));
    }
    return new Response('{}', { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, events, urls };
}

// Points an ambient SENTRY_DSN at a local server that counts the requests reaching it, until disposed.
export function ambientSentrySink() {
  const ambient = process.env.SENTRY_DSN;
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      hits++;
      return new Response('{}');
    },
  });
  process.env.SENTRY_DSN = `http://key@127.0.0.1:${server.port}/1`;
  return {
    get hits() {
      return hits;
    },
    async [Symbol.asyncDispose]() {
      if (ambient === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = ambient;
      await server.stop(true);
    },
  };
}
