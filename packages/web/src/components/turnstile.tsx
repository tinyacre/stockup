import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCapabilities } from '@/lib/capabilities';

// Cloudflare serves api.js only from this URL and asks that it not be proxied or cached, since it updates the
// script in place (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).
const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      size: 'flexible';
      callback(token: string): void;
      'expired-callback'(): void;
      'error-callback'(): void;
    },
  ): string | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// One script tag serves every widget; the promise is shared only while the script is in flight, so a failed
// load is retried by the next mount.
let loading: Promise<TurnstileApi> | undefined;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.addEventListener('load', () => {
      loading = undefined;
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile script loaded without its API'));
    });
    script.addEventListener('error', () => {
      loading = undefined;
      script.remove();
      reject(new Error('Turnstile script failed to load'));
    });
    document.head.appendChild(script);
  });
  return loading;
}

// `onToken` receives the passed challenge's token, or null once it expires or errors. A token is good for one
// request, so the parent remounts the component (changes its key) to ask for the next one.
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken(token: string | null): void }) {
  const container = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const [passed, setPassed] = useState(false);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | undefined;
    const settle = (token: string | null) => {
      setPassed(token !== null);
      onTokenRef.current(token);
    };
    loadTurnstile().then(
      (turnstile) => {
        if (cancelled || !container.current) return;
        try {
          widgetId = turnstile.render(container.current, {
            sitekey: siteKey,
            size: 'flexible',
            callback: settle,
            'expired-callback': () => settle(null),
            'error-callback': () => settle(null),
          });
        } catch (error) {
          // A refused site key is the instance's misconfiguration, which no reload on the visitor's side fixes.
          console.error('Turnstile render failed', error);
          setFailure('人机验证不可用，请联系实例管理员');
        }
      },
      () => !cancelled && setFailure('人机验证加载失败，请检查网络后刷新页面'),
    );
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  return (
    <>
      <div ref={container} data-testid="turnstile" hidden={passed} />
      {failure && (
        <p role="alert" className="text-destructive text-sm">
          {failure}
        </p>
      )}
    </>
  );
}

export const turnstileErrors = { turnstile_failed: '人机验证失败，请重试' };

export interface TurnstileChallenge {
  // The widget to place in the form; null when the instance does not challenge.
  widget: ReactNode;
  // Sent as the x-turnstile-token header; undefined until the visitor passes, or when nothing is challenged.
  token: string | undefined;
  // Whether a challenged request may be sent now; false until the instance has said whether it challenges.
  ready: boolean;
  // Asks for a fresh challenge. Call after every request that carried the token, since the server spends it
  // whether the request succeeds or not.
  spend(): void;
}

// The challenge for a form whose requests the server guards with Turnstile, keyed by the instance's site key.
export function useTurnstile(): TurnstileChallenge {
  const capabilities = useCapabilities();
  const siteKey = capabilities?.turnstileSiteKey ?? null;
  const [round, setRound] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const spend = useCallback(() => {
    setToken(null);
    setRound((r) => r + 1);
  }, []);
  return {
    widget: siteKey && <Turnstile key={round} siteKey={siteKey} onToken={setToken} />,
    token: token ?? undefined,
    ready: capabilities !== undefined && (!siteKey || token !== null),
    spend,
  };
}
