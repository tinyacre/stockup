import type { TurnstileVerifier } from '../../src/turnstile';

export const PASSING_TURNSTILE_TOKEN = 'turnstile-pass';

// Stands in for Cloudflare: passes exactly PASSING_TURNSTILE_TOKEN and records every verification.
export interface FakeTurnstile extends TurnstileVerifier {
  calls: { token: string; remoteIp?: string }[];
}

export function fakeTurnstile(): FakeTurnstile {
  const fake: FakeTurnstile = {
    siteKey: 'test-site-key',
    calls: [],
    async verify(token, remoteIp) {
      fake.calls.push({ token, remoteIp });
      return token === PASSING_TURNSTILE_TOKEN;
    },
  };
  return fake;
}
