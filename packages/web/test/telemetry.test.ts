import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { followTelemetryChoice as Follow } from '@/lib/telemetry';

const requests: string[] = [];
const stored = new Map<string, string>();
const nav = { globalPrivacyControl: false, doNotTrack: null as string | null };
let followTelemetryChoice: typeof Follow;

beforeAll(async () => {
  Object.assign(globalThis, {
    fetch: async (input: RequestInfo | URL) => {
      requests.push(String(input));
      const body =
        String(input) === '/api/capabilities'
          ? { signup: false, email: false, turnstileSiteKey: null, telemetry: null }
          : {};
      return Response.json(body);
    },
    localStorage: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
    },
    location: { pathname: '/products/0193-abcd', search: '', hash: '' },
  });
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  ({ followTelemetryChoice } = await import('@/lib/telemetry'));
});

beforeEach(() => {
  requests.length = 0;
  stored.clear();
  nav.globalPrivacyControl = false;
  nav.doNotTrack = null;
});

describe('following the help-improve choice', () => {
  test('a device that turned it off loads nothing and sends nothing before anyone signs in', async () => {
    stored.set('tinyacre.telemetry.enabled', '0');
    await followTelemetryChoice('device');
    expect(requests).toEqual([]);
    expect(stored.get('tinyacre.telemetry.enabled')).toBe('0');
  });

  test("an account that turned it off loads nothing, and the device remembers the account's choice", async () => {
    await followTelemetryChoice({ account: false });
    expect(requests).toEqual([]);
    expect(stored.get('tinyacre.telemetry.enabled')).toBe('0');
  });

  test('while the choice is unknown nothing is loaded and the device cache is left as it was', async () => {
    stored.set('tinyacre.telemetry.enabled', '1');
    await followTelemetryChoice('unknown');
    expect(requests).toEqual([]);
    expect(stored.get('tinyacre.telemetry.enabled')).toBe('1');
  });

  test('a browser sending GPC or DNT loads nothing, whatever the account says', async () => {
    nav.globalPrivacyControl = true;
    await followTelemetryChoice({ account: true });
    nav.globalPrivacyControl = false;
    nav.doNotTrack = '1';
    await followTelemetryChoice({ account: true });
    expect(requests).toEqual([]);
  });

  test('on an instance without telemetry, an account that helps asks only for the capabilities', async () => {
    await followTelemetryChoice({ account: true });
    expect(requests).toEqual(['/api/capabilities']);
    expect(stored.get('tinyacre.telemetry.enabled')).toBe('1');
  });
});
