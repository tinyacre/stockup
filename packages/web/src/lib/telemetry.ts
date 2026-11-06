import type { Telemetry } from '@tinyacre/telemetry';
import { loadCapabilities } from '@/lib/capabilities';
import { routeTemplate } from '@/lib/routes';

// Front-end analytics and errors go through @tinyacre/telemetry, which fixes what may leave the browser
// (tinyacre/telemetry's data boundary); this module decides whose choice applies and which page is open.

// Pageviews only, until there are custom events worth counting.
const events = [] as const;

// The device cache @tinyacre/telemetry reads at start and writes on every setEnabled ('0' is off).
const deviceKey = 'tinyacre.telemetry.enabled';

function deviceChoice() {
  try {
    return localStorage.getItem(deviceKey) !== '0';
  } catch {
    return true;
  }
}

// What setEnabled would cache, for a device that applies a choice without loading the package.
function rememberOnDevice(enabled: boolean) {
  try {
    localStorage.setItem(deviceKey, enabled ? '1' : '0');
  } catch {
    // Storage can be unavailable; the account still holds the choice.
  }
}

// The same reading @tinyacre/telemetry applies: such a browser sends nothing whatever the switch says.
export function browserRefusesTracking() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

// Loaded the first time a choice turns telemetry on, on an instance that configures it, and started held until
// that choice is applied.
let started: Promise<Telemetry<typeof events> | null> | undefined;

function telemetry() {
  started ??= loadCapabilities().then(async ({ telemetry: setup }) => {
    // Capabilities that could not be read are asked for again by the next choice.
    if (!setup) {
      started = undefined;
      return null;
    }
    try {
      const { startTelemetry } = await import('@tinyacre/telemetry');
      return await startTelemetry({ ...setup, events, routeTemplate, held: true });
    } catch {
      // The precache leaves the telemetry chunks out, so offline they cannot load; the next choice tries again.
      started = undefined;
      return null;
    }
  });
  return started;
}

export type TelemetryChoice = { account: boolean } | 'device' | 'unknown';

// Each choice replaces the last; one still loading when a newer one arrives applies nothing.
let latest = 0;
let decided = false;
let reportedPath: string | undefined;
// Whether the last known choice sends, so turning it back on reports the page then open as a new view.
let sending: boolean | undefined;

// Nothing is sent while the choice is unknown: a signed-in account's own applies, or the device's while nobody is
// signed in. A device that will not send never loads the package, and one that already runs it stops.
export async function followTelemetryChoice(choice: TelemetryChoice) {
  const mine = ++latest;
  decided = false;
  if (choice === 'unknown') {
    const t = await started;
    if (mine === latest) t?.hold();
    return;
  }
  const enabled = choice === 'device' ? deviceChoice() : choice.account;
  const t = enabled && !browserRefusesTracking() ? await telemetry() : await started;
  if (mine !== latest) return;
  if (t) await t.setEnabled(enabled);
  else rememberOnDevice(enabled);
  if (mine !== latest) return;
  const nowSending = Boolean(t) && enabled && !browserRefusesTracking();
  if (nowSending && sending === false) reportedPath = undefined;
  sending = nowSending;
  decided = true;
  // A page opened while the choice was unknown was not reported, so the one open now is, unless it already was.
  reportPageview();
}

export function reportPageview() {
  if (!decided || location.pathname === reportedPath) return;
  reportedPath = location.pathname;
  void started?.then((t) => t?.pageview());
}
