import { useEffect, useState } from 'react';

// Matches the stylesheet's `wide` breakpoint.
export const wideScreen = '(min-width: 900px)';

export function useWideScreen() {
  const [wide, setWide] = useState(() => window.matchMedia(wideScreen).matches);
  useEffect(() => {
    const media = window.matchMedia(wideScreen);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}
