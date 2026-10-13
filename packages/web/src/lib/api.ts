export interface Me {
  user: { id: string; username: string; name: string; isInstanceAdmin: boolean };
  household: { id: string; name: string; role: string };
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
};
