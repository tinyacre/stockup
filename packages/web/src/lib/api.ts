import type { Unit } from '@stockup/domain';

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
  note: string;
}

export interface NewProduct {
  categoryId: string;
  name: string;
  pricingUnit: Unit;
  baseSize: number;
  note: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, payload?.error ?? payload?.code);
  return payload as T;
}

export const api = {
  setupStatus: () => request<{ needsSetup: boolean }>('/api/setup'),
  setUp: (body: { username: string; password: string; name: string; householdName: string }) =>
    request('/api/setup', { method: 'POST', body }),
  me: () => request<Me>('/api/me'),
  signIn: (body: { username: string; password: string }) =>
    request('/api/auth/sign-in/username', { method: 'POST', body }),
  signOut: () => request('/api/auth/sign-out', { method: 'POST', body: {} }),

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

  products: (categoryId: string) =>
    request<Product[]>(`/api/products?categoryId=${encodeURIComponent(categoryId)}`),
  createProduct: (body: NewProduct) => request<Product>('/api/products', { method: 'POST', body }),
  updateProduct: (id: string, body: { name?: string; categoryId?: string; note?: string }) =>
    request<Product>(`/api/products/${id}`, { method: 'PATCH', body }),
  deleteProduct: (id: string) => request(`/api/products/${id}`, { method: 'DELETE' }),
};
