import { useEffect, useMemo, useState } from 'react';
import { describeError } from '@/components/editing';
import { api, type Product } from '@/lib/api';

// Waits for a pause in typing, and drops responses that arrive after the query has moved on.
// The results keep the query they answer, so callers can tell when they are stale.
export function useProductSearch(query: string) {
  const [found, setFound] = useState<{ query: string; products: Product[] }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setError(undefined);
    if (!query) {
      setFound(undefined);
      return;
    }
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

type SearchByName = typeof import('@stockup/domain/search').searchByName;

let searchModule: Promise<SearchByName> | undefined;

// The pinyin dictionary behind the search is large, so it loads apart from the app.
function loadSearch() {
  searchModule ??= import('@stockup/domain/search').then(
    (m) => m.searchByName,
    (error) => {
      // The next search retries the download.
      searchModule = undefined;
      throw error;
    },
  );
  return searchModule;
}

// Searches the products already on the device as the server's product search does, so it works offline.
// Undefined until the search has loaded.
export function useLocalProductSearch<P extends Product>(products: P[] | undefined, query: string, limit = 20) {
  const [searchByName, setSearchByName] = useState<SearchByName>();
  useEffect(() => {
    loadSearch().then((search) => setSearchByName(() => search));
  }, []);
  return useMemo(
    () =>
      searchByName && products && query
        ? searchByName(products.filter((p) => !p.archived), query).slice(0, limit)
        : undefined,
    [searchByName, products, query, limit],
  );
}
