import type { Discount, PromotionLowest, Size, Unit } from '@stockup/domain';

export interface Me {
  user: { id: string; username: string; name: string; isInstanceAdmin: boolean };
  household: { id: string; name: string; role: string };
}

export interface CategoryGroup {
  id: string;
  name: string;
  categories: { id: string; name: string; productCount: number }[];
}

export interface Category {
  id: string;
  name: string;
  categoryGroupId: string;
}

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  pricingUnit: Unit;
  baseSize: number;
  // Cents per Base Size.
  stockLine: number | null;
  note: string;
  archived: boolean;
}

export interface ProductDetail extends Product {
  lowestUnitPrice: number | null;
}

export interface ProductSummary extends ProductDetail {
  latestPrice: { date: string; unitPrice: number } | null;
}

export interface NewProduct {
  categoryId: string;
  name: string;
  pricingUnit: Unit;
  baseSize: number;
  note: string;
}

export interface Channel {
  id: string;
  name: string;
  archived: boolean;
}

export interface Promotion {
  id: string;
  name: string;
  // Month-days "MM-DD"; an end before the start spans the new year.
  startsOn: string;
  endsOn: string;
}

export interface PriceRecordInput {
  date: string;
  channelId: string;
  purchased: boolean;
  promotionId: string | null;
  listPrice: number;
  discounts: Discount[];
  quantity: number;
  size: Size;
  note: string;
}

export interface PriceRecord extends Omit<PriceRecordInput, 'channelId' | 'promotionId'> {
  id: string;
  productId: string;
  channel: Channel;
  promotion: { id: string; name: string } | null;
  enteredSize: Size;
  recordedBy: { id: string; name: string } | null;
  source: 'manual' | 'recognition' | 'mcp';
  netPrice: number;
  unitPrice: number;
}

export interface PriceReferences {
  productId: string;
  lowestUnitPrice: number;
  promotionLowests: PromotionLowest[];
  recentSizes: Size[];
}

// The request never reached StockUp, as when the device is offline.
export class NetworkError extends Error {
  override name = 'NetworkError';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

// Payloads the service worker answered from its cache because the network failed.
const cachedPayloads = new WeakSet<object>();

export function isFromCache(payload: unknown) {
  return typeof payload === 'object' && payload !== null && cachedPayloads.has(payload);
}

// Household data cached by the service worker belongs to whoever is signed in.
async function clearCachedData() {
  if ('caches' in window) await caches.delete('api');
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new NetworkError(String(error), { cause: error });
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, payload?.error ?? payload?.code);
  if (res.headers.has('x-stockup-from-cache') && typeof payload === 'object' && payload !== null) {
    cachedPayloads.add(payload);
  }
  return payload as T;
}

export const api = {
  setupStatus: () => request<{ needsSetup: boolean }>('/api/setup'),
  setUp: (body: { username: string; password: string; name: string; householdName: string }) =>
    request('/api/setup', { method: 'POST', body }),
  me: async () => {
    try {
      return await request<Me>('/api/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearCachedData();
      throw error;
    }
  },
  signIn: async (body: { username: string; password: string }) => {
    await request('/api/auth/sign-in/username', { method: 'POST', body });
    await clearCachedData();
  },
  signOut: async () => {
    await request('/api/auth/sign-out', { method: 'POST', body: {} });
    await clearCachedData();
  },

  catalog: () => request<CategoryGroup[]>('/api/category-groups'),
  createCategoryGroup: (body: { name: string }) =>
    request<Omit<CategoryGroup, 'categories'>>('/api/category-groups', { method: 'POST', body }),
  updateCategoryGroup: (id: string, body: { name: string }) =>
    request(`/api/category-groups/${id}`, { method: 'PATCH', body }),
  deleteCategoryGroup: (id: string) => request(`/api/category-groups/${id}`, { method: 'DELETE' }),

  createCategory: (body: { categoryGroupId: string; name: string }) =>
    request<Category>('/api/categories', { method: 'POST', body }),
  updateCategory: (id: string, body: { name?: string; categoryGroupId?: string }) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body }),
  deleteCategory: (id: string) => request(`/api/categories/${id}`, { method: 'DELETE' }),

  products: (categoryId?: string) =>
    request<ProductSummary[]>(
      categoryId ? `/api/products?categoryId=${encodeURIComponent(categoryId)}` : '/api/products',
    ),
  createProduct: (body: NewProduct) => request<Product>('/api/products', { method: 'POST', body }),
  updateProduct: (id: string, body: { name?: string; categoryId?: string; note?: string; stockLine?: number | null }) =>
    request<Product>(`/api/products/${id}`, { method: 'PATCH', body }),
  searchProducts: (query: string) =>
    request<Product[]>(`/api/products/search?q=${encodeURIComponent(query)}`),
  product: (id: string) => request<ProductDetail>(`/api/products/${id}`),
  deleteProduct: (id: string) => request(`/api/products/${id}`, { method: 'DELETE' }),

  channels: () => request<Channel[]>('/api/channels?includeArchived=true'),
  lastUsedChannel: () => request<{ channel: Channel | null }>('/api/channels/last-used'),
  createChannel: (body: { name: string }) => request<Channel>('/api/channels', { method: 'POST', body }),
  updateChannel: (id: string, body: { name?: string; archived?: boolean }) =>
    request<Channel>(`/api/channels/${id}`, { method: 'PATCH', body }),
  deleteChannel: (id: string) => request(`/api/channels/${id}`, { method: 'DELETE' }),

  promotions: () => request<Promotion[]>('/api/promotions'),
  createPromotion: (body: Omit<Promotion, 'id'>) => request<Promotion>('/api/promotions', { method: 'POST', body }),
  updatePromotion: (id: string, body: Partial<Omit<Promotion, 'id'>>) =>
    request<Promotion>(`/api/promotions/${id}`, { method: 'PATCH', body }),

  priceRecords: (productId: string) =>
    request<PriceRecord[]>(`/api/price-records?productId=${encodeURIComponent(productId)}`),
  createPriceRecord: (body: PriceRecordInput & { productId: string }) =>
    request<PriceRecord>('/api/price-records', { method: 'POST', body }),
  replacePriceRecord: (id: string, body: PriceRecordInput) =>
    request<PriceRecord>(`/api/price-records/${id}`, { method: 'PUT', body }),
  deletePriceRecord: (id: string) => request(`/api/price-records/${id}`, { method: 'DELETE' }),
  priceReferences: () => request<PriceReferences[]>('/api/price-references'),
};
