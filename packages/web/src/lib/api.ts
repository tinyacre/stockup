import type { Discount, PromotionLowest, Size, Unit, Verdict } from '@stockup/domain';
import type { Theme } from '@/lib/theme';

export interface Me {
  // `email` is null until the member has a verified address.
  user: { id: string; username: string; name: string; email: string | null; theme: Theme; isInstanceAdmin: boolean };
  household: { id: string; name: string; role: string };
}

export interface Invitation {
  // Also the secret part of the invitation link.
  id: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string };
}

export interface Member {
  // The user ID, as in a price record's recordedBy.
  id: string;
  name: string;
  username: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface Household {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface OAuthClient {
  client_id: string;
  client_name?: string;
  client_uri?: string;
}

export interface AuthorizedClient {
  // The URL of the client's metadata document.
  clientId: string;
  name: string | null;
  uri: string | null;
  scopes: string[];
  authorizedAt: string;
}

export interface NewAccount {
  username: string;
  password: string;
  name: string;
}

export interface CategoryGroup {
  id: string;
  name: string;
  // Products placed in the group outside any category.
  productCount: number;
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
  categoryGroupId: string;
  // Null for a product placed in its group outside any category.
  categoryId: string | null;
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
  // Judged against the current stock line and the lowest unit price among the product's other records.
  latestPrice: { date: string; unitPrice: number; verdict: Verdict | null } | null;
}

// A category brings its group along; a group alone places the product outside any category.
export type Placement = { categoryId: string; categoryGroupId?: never } | { categoryGroupId: string; categoryId?: never };

export interface ProductChanges {
  name?: string;
  categoryId?: string;
  categoryGroupId?: string;
  note?: string;
  // Only to another unit of the same dimension.
  pricingUnit?: Unit;
  // In the new pricing unit when that changes too.
  baseSize?: number;
  stockLine?: number | null;
  archived?: boolean;
}

export type NewProduct = Placement & {
  name: string;
  pricingUnit: Unit;
  baseSize: number;
  note: string;
};

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

export interface Evidence {
  id: string;
  contentType: string;
  // Bytes.
  size: number;
  createdAt: string;
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
  // Oldest first. Missing from records the service worker cached before Evidence existed.
  evidence?: Evidence[];
}

export interface RecognitionDraft {
  id: string;
  name: string;
  // As the screenshot writes it.
  sizeText: string | null;
  // Null, like the other values, when it could not be read.
  size: Size | null;
  quantity: number | null;
  // Cents.
  listPrice: number | null;
  discounts: Discount[];
  // Cents: its share of the order discounts, null while a draft's list price is unknown.
  orderDiscount: number | null;
  // Suggested by name, or chosen by a member.
  suggestedProduct: { id: string; name: string; pricingUnit: Unit; baseSize: number } | null;
}

export interface DraftChanges {
  name?: string;
  size?: Size | null;
  quantity?: number | null;
  listPrice?: number | null;
  discounts?: Discount[];
  orderDiscount?: number;
  productId?: string | null;
}

export interface Confirmation {
  date: string;
  channelId: string;
  purchased: boolean;
}

export interface Recognition {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  error: 'recognition_unavailable' | 'recognition_failed' | 'recognition_interrupted' | null;
  requestedBy: { id: string; name: string } | null;
  screenshot: { contentType: string; size: number };
  date: string | null;
  channel: string | null;
  orderDiscounts: Discount[];
  drafts: RecognitionDraft[];
  createdAt: string;
  finishedAt: string | null;
  // Drafts are gone once confirmed.
  confirmedAt: string | null;
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
    // The whole error payload, for the details some errors carry beside their code.
    readonly payload: unknown = null,
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

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
  let res: Response;
  try {
    const json = init?.body !== undefined && !(init.body instanceof FormData);
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: { ...(json && { 'content-type': 'application/json' }), ...init?.headers },
      body: json ? JSON.stringify(init.body) : (init?.body as FormData | undefined),
    });
  } catch (error) {
    throw new NetworkError(String(error), { cause: error });
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, payload?.error ?? payload?.code, payload);
  if (res.headers.has('x-stockup-from-cache') && typeof payload === 'object' && payload !== null) {
    cachedPayloads.add(payload);
  }
  return payload as T;
}

export interface Capabilities {
  signup: boolean;
  email: boolean;
  turnstileSiteKey: string | null;
}

export type EmailCodePurpose = 'register' | 'join' | 'password-reset' | 'change-email';

// Turnstile tokens travel in a header so the server can check them before reading the body.
function turnstileHeaders(token: string | undefined) {
  return token ? { 'x-turnstile-token': token } : undefined;
}

export const api = {
  capabilities: () => request<Capabilities>('/api/capabilities'),
  sendEmailCode: (body: { email: string; purpose: EmailCodePurpose; invitationId?: string }, turnstileToken?: string) =>
    request('/api/email-codes', { method: 'POST', body, headers: turnstileHeaders(turnstileToken) }),
  signUp: async (body: NewAccount & { email: string; code: string }, turnstileToken?: string) => {
    await request('/api/signup', { method: 'POST', body, headers: turnstileHeaders(turnstileToken) });
    await clearCachedData();
  },
  resetPassword: (body: { email: string; code: string; newPassword: string }, turnstileToken?: string) =>
    request('/api/password-reset', { method: 'POST', body, headers: turnstileHeaders(turnstileToken) }),
  setupStatus: () => request<{ needsSetup: boolean }>('/api/setup'),
  setUp: (body: NewAccount & { householdName: string }) => request('/api/setup', { method: 'POST', body }),
  me: async () => {
    try {
      return await request<Me>('/api/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearCachedData();
      throw error;
    }
  },
  // With the signed query of an authorization request, the response names the page that continues it.
  signIn: async ({ oauthQuery, ...credentials }: { username: string; password: string; oauthQuery?: string }) => {
    const signedIn = await request<{ url?: string }>('/api/auth/sign-in/username', {
      method: 'POST',
      body: { ...credentials, oauth_query: oauthQuery },
    });
    await clearCachedData();
    return signedIn;
  },
  signOut: async () => {
    await request('/api/auth/sign-out', { method: 'POST', body: {} });
    await clearCachedData();
  },

  oauthClient: (clientId: string) =>
    request<OAuthClient>(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`),
  // Resolves to where the authorization request continues: back to the client, with a code or a denial.
  consent: (body: { accept: boolean; oauthQuery: string }) =>
    request<{ url: string }>('/api/auth/oauth2/consent', {
      method: 'POST',
      body: { accept: body.accept, oauth_query: body.oauthQuery },
    }),

  rename: (body: { name: string }) => request<Me>('/api/me', { method: 'PATCH', body }),
  renameHousehold: (body: { name: string }) =>
    request<{ id: string; name: string }>('/api/household', { method: 'PATCH', body }),
  setTheme: (theme: Theme) => request<Me>('/api/me', { method: 'PATCH', body: { theme } }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request('/api/me/password', { method: 'POST', body }),
  signOutOthers: () => request('/api/me/sign-out-others', { method: 'POST' }),
  changeEmail: (body: { email: string; code: string }) => request<Me>('/api/me/email', { method: 'POST', body }),
  authorizedClients: () => request<AuthorizedClient[]>('/api/mcp-clients'),
  revokeClient: (clientId: string) =>
    request(`/api/mcp-clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),

  members: () => request<Member[]>('/api/members'),
  removeMember: (id: string) => request(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  makeAdmin: (id: string) => request(`/api/members/${encodeURIComponent(id)}/make-admin`, { method: 'POST' }),

  households: () => request<Household[]>('/api/households'),
  createHousehold: (body: { householdName: string; admin: NewAccount }) =>
    request<{ householdId: string; userId: string }>('/api/households', { method: 'POST', body }),

  invitations: () => request<Invitation[]>('/api/invitations'),
  createInvitation: (body: { expiresInDays: number }) =>
    request<Invitation>('/api/invitations', { method: 'POST', body }),
  revokeInvitation: (id: string) =>
    request<Invitation>(`/api/invitations/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  describeInvitation: (id: string) =>
    request<{ householdName: string; invitedBy: string }>(`/api/join/${encodeURIComponent(id)}`),
  rejoin: (id: string) => request(`/api/join/${encodeURIComponent(id)}/rejoin`, { method: 'POST' }),
  // `email` and its join code are required when the instance can mail, and ignored otherwise.
  join: async (id: string, body: NewAccount & { email?: string; code?: string }) => {
    await request(`/api/join/${encodeURIComponent(id)}`, { method: 'POST', body });
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

  products: (placement?: Placement, { includeArchived = false } = {}) => {
    const query = new URLSearchParams();
    if (placement?.categoryId) query.set('categoryId', placement.categoryId);
    if (placement?.categoryGroupId) query.set('categoryGroupId', placement.categoryGroupId);
    if (includeArchived) query.set('includeArchived', 'true');
    return request<ProductSummary[]>(query.size ? `/api/products?${query}` : '/api/products');
  },
  createProduct: (body: NewProduct) => request<Product>('/api/products', { method: 'POST', body }),
  updateProduct: (id: string, body: ProductChanges) =>
    request<Product>(`/api/products/${id}`, { method: 'PATCH', body }),
  mergeProduct: (keptId: string, mergedId: string) =>
    request<Product>(`/api/products/${keptId}/merge`, { method: 'POST', body: { productId: mergedId } }),
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
  uploadEvidence: (priceRecordId: string, files: File[]) => {
    const body = new FormData();
    for (const file of files) body.append('files', file);
    return request<Evidence[]>(`/api/price-records/${priceRecordId}/evidence`, { method: 'POST', body });
  },
  deleteEvidence: (id: string) => request(`/api/evidence/${id}`, { method: 'DELETE' }),
  evidenceUrl: (id: string) => `/api/evidence/${encodeURIComponent(id)}`,
  recognizer: () => request<{ available: boolean }>('/api/recognizer'),
  startRecognition: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<Recognition>('/api/recognitions', { method: 'POST', body });
  },
  recognition: (id: string) => request<Recognition>(`/api/recognitions/${encodeURIComponent(id)}`),
  editDraft: (recognitionId: string, draftId: string, body: DraftChanges) =>
    request<Recognition>(
      `/api/recognitions/${encodeURIComponent(recognitionId)}/drafts/${encodeURIComponent(draftId)}`,
      { method: 'PATCH', body },
    ),
  deleteDraft: (recognitionId: string, draftId: string) =>
    request<Recognition>(
      `/api/recognitions/${encodeURIComponent(recognitionId)}/drafts/${encodeURIComponent(draftId)}`,
      { method: 'DELETE' },
    ),
  confirmRecognition: (id: string, body: Confirmation) =>
    request<{ priceRecords: PriceRecord[] }>(`/api/recognitions/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
      body,
    }),
  recognitionScreenshotUrl: (id: string) => `/api/recognitions/${encodeURIComponent(id)}/screenshot`,
  priceReferences: () => request<PriceReferences[]>('/api/price-references'),
};
