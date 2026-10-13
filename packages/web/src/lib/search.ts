import { useEffect, useState } from 'react';
import { describeError } from '@/components/editing';
import { api, type Product } from '@/lib/api';

// Waits for a pause in typing, and drops responses that arrive after the query has moved on.
// The results keep the query they answer, so callers can tell when they are stale.
export function useProductSearch(query: string) {
  const [found, setFound] = useState<{ query: string; products: Product[] }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const products = await api.searchProducts(query);
        if (current) {
          setFound({ query, products });
          setError(undefined);
        }
      } catch (e) {
        if (current) setError(describeError(e));
      }
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  return { found, error };
}
