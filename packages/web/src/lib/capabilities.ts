import { useEffect, useState } from 'react';
import { api, type Capabilities } from '@/lib/api';

// Used when the server cannot be asked: sign-in offers neither signup nor password reset, joining and settings
// ask for no email, no form shows a Turnstile challenge, and no telemetry is loaded.
const none: Capabilities = { signup: false, email: false, turnstileSiteKey: null, telemetry: null };

let loaded: Promise<Capabilities> | undefined;

// Fetched once per page load: they change only when the server restarts with another setup.
export function loadCapabilities() {
  loaded ??= api.capabilities().catch(() => {
    loaded = undefined;
    return none;
  });
  return loaded;
}

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities>();
  useEffect(() => {
    let current = true;
    loadCapabilities().then((found) => current && setCapabilities(found));
    return () => {
      current = false;
    };
  }, []);
  return capabilities;
}
