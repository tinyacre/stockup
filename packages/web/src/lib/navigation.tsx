import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react';

// The state travels with the history entry, so pages can restore what they showed there.
export type Navigate = (path: string, state?: unknown) => void;

const NavigationContext = createContext<Navigate>((path) => window.location.assign(path));

export const NavigationProvider = NavigationContext.Provider;

export function useNavigate() {
  return useContext(NavigationContext);
}

export function productPath(id: string) {
  return `/products/${encodeURIComponent(id)}`;
}

// An in-app link: a plain click moves within the app, while modified clicks and new tabs keep the browser's behaviour.
export function Link({ href, onClick, ...props }: ComponentProps<'a'> & { href: string }) {
  const navigate = useNavigate();
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || props.target) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }
  return <a href={href} onClick={follow} {...props} />;
}
