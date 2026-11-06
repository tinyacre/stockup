import type { RouteLocation } from '@tinyacre/telemetry';
import { sections, type SectionPath } from '@/components/app-shell';

// Pages shown in place of the app shell, each at a path of its own.
export const sessionPages = {
  signUp: '/sign-up',
  resetPassword: '/reset-password',
  oauthSignIn: '/oauth/sign-in',
  oauthConsent: '/oauth/consent',
} as const;

export function invitationIn(pathname: string) {
  // Invitation IDs are UUIDs, so the path segment needs no decoding.
  return /^\/join\/([^/]+)$/.exec(pathname)?.[1];
}

// A product page belongs to the catalog section, and a recognition to the recognition section.
export interface Route {
  section: SectionPath;
  productId?: string;
  recognitionId?: string;
}

// Ids as they appear in the path, still encoded.
function matchRoute(pathname: string): Route | undefined {
  const product = /^\/products\/([^/]+)$/.exec(pathname);
  if (product) return { section: '/products', productId: product[1] };
  const recognition = /^\/recognitions\/([^/]+)$/.exec(pathname);
  if (recognition) return { section: '/recognitions', recognitionId: recognition[1] };
  const section = sections.find((s) => s.path === pathname);
  return section && { section: section.path };
}

// The app shell's page at `pathname`, if it has one.
export function routeAt(pathname: string): Route | undefined {
  const route = matchRoute(pathname);
  if (!route) return undefined;
  const { section, productId, recognitionId } = route;
  if (productId !== undefined) return { section, productId: decodeURIComponent(productId) };
  if (recognitionId !== undefined) return { section, recognitionId: decodeURIComponent(recognitionId) };
  return route;
}

// Every location maps to a template, so no id or other path segment leaves the device.
export function routeTemplate({ pathname }: RouteLocation): string {
  if ((Object.values(sessionPages) as string[]).includes(pathname)) return pathname;
  if (invitationIn(pathname)) return '/join/:id';
  const route = matchRoute(pathname);
  if (route?.productId) return '/products/:id';
  if (route?.recognitionId) return '/recognitions/:id';
  return route?.section ?? '/unknown';
}
