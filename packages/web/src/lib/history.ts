import { useCallback, useState } from 'react';

// The value lives in the current history entry, so returning to the entry shows it again.
export function useHistoryState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => window.history.state?.[key] ?? initial);
  const update = useCallback(
    (next: T) => {
      window.history.replaceState({ ...window.history.state, [key]: next }, '');
      setValue(next);
    },
    [key],
  );
  return [value, update] as const;
}
