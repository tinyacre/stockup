import type { Context, MiddlewareHandler } from 'hono';
import { clientIp } from './client-ip';
import type { TurnstileConfig } from './config';

export interface TurnstileVerifier {
  // Served to the browser, which renders the challenge with it.
  siteKey: string;
  verify(token: string, remoteIp: string | undefined): Promise<boolean>;
}

const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const timeoutMs = 10_000;

// Fails closed: a token counts only when Cloudflare confirms it, so an outage refuses requests rather than
// letting scripts through.
export function cloudflareTurnstile(
  config: TurnstileConfig,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): TurnstileVerifier {
  return {
    siteKey: config.siteKey,
    async verify(token, remoteIp) {
      if (!token) return false;
      const body = new URLSearchParams({ secret: config.secretKey, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      try {
        const res = await fetch(siteverifyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          console.warn(`Turnstile siteverify answered ${res.status}`);
          return false;
        }
        const answer = (await res.json()) as { success?: unknown };
        return answer.success === true;
      } catch (error) {
        console.warn(`Turnstile siteverify failed: ${String(error)}`);
        return false;
      }
    },
  };
}

// A header rather than a body field, so the Better Auth sign-in endpoints can be checked without reading their bodies.
export function turnstileToken(c: Context) {
  return c.req.header('x-turnstile-token') ?? '';
}

export async function passesTurnstile(c: Context, turnstile?: TurnstileVerifier, clientIpHeader?: string) {
  if (!turnstile) return true;
  return turnstile.verify(turnstileToken(c), clientIp(c.req.raw.headers, clientIpHeader));
}

export function requireTurnstile(turnstile?: TurnstileVerifier, clientIpHeader?: string): MiddlewareHandler {
  return async (c, next) => {
    if (!(await passesTurnstile(c, turnstile, clientIpHeader))) return c.json({ error: 'turnstile_failed' }, 400);
    await next();
  };
}
