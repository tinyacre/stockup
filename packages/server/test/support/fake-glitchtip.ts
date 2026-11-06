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
