import { useEffect, useState } from 'react';
import { api, type Capabilities } from '@/lib/api';

// Used when the server cannot be asked: sign-in offers neither signup nor password reset, joining and settings
// ask for no email, and no form shows a Turnstile challenge.
const none: Capabilities = { signup: false, email: false, turnstileSiteKey: null };

let loaded: Promise<Capabilities> | undefined;

// Fetched once per page load: they change only when the server restarts with another setup.
export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities>();
  useEffect(() => {
    loaded ??= api.capabilities().catch(() => {
      loaded = undefined;
      return none;
    });
    let current = true;
    loaded.then((found) => current && setCapabilities(found));
    return () => {
      current = false;
    };
  }, []);
  return capabilities;
}
