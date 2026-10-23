import { QueryClient, queryOptions, useQueryClient } from '@tanstack/react-query';
import { describeError } from '@/components/editing';
import { api, isFromCache, type Placement } from '@/lib/api';

const staleRetryDelay = 3000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline, the service worker answers from its cache, so requests go out whatever the browser reports.
      networkMode: 'always',
      // A failed load shows a retry button at once instead of waiting through silent retries.
      retry: false,
      gcTime: 30 * 60 * 1000,
      // The network can still be down for a moment after the device reports it is back, so a cached answer
      // is read again until a fresh one arrives.
      refetchInterval: (query) => (isFromCache(query.state.data) && navigator.onLine ? staleRetryDelay : false),
    },
  },
});

export function loadErrorOf(error: Error | null, messages?: Record<string, string>) {
  return error ? describeError(error, messages) : undefined;
}

// A write can change counts, price summaries and references shown anywhere, and household data is small,
// so every write marks all of it stale: the page on screen reads it again, the others when next shown.
export function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

export const queries = {
  catalog: () => queryOptions({ queryKey: ['catalog'], queryFn: api.catalog }),
  products: (placement?: Placement, { includeArchived = false } = {}) =>
    queryOptions({
      queryKey: ['products', placement ?? null, includeArchived],
      queryFn: () => api.products(placement, { includeArchived }),
    }),
  product: (id: string) => queryOptions({ queryKey: ['product', id], queryFn: () => api.product(id) }),
  priceRecords: (productId: string) =>
    queryOptions({ queryKey: ['price-records', productId], queryFn: () => api.priceRecords(productId) }),
  priceReferences: () => queryOptions({ queryKey: ['price-references'], queryFn: api.priceReferences }),
  channels: () => queryOptions({ queryKey: ['channels'], queryFn: api.channels }),
  lastUsedChannel: () => queryOptions({ queryKey: ['last-used-channel'], queryFn: api.lastUsedChannel }),
  promotions: () => queryOptions({ queryKey: ['promotions'], queryFn: api.promotions }),
  members: () => queryOptions({ queryKey: ['members'], queryFn: api.members }),
  invitations: () => queryOptions({ queryKey: ['invitations'], queryFn: api.invitations }),
  households: () => queryOptions({ queryKey: ['households'], queryFn: api.households }),
  recognizer: () => queryOptions({ queryKey: ['recognizer'], queryFn: api.recognizer }),
};
