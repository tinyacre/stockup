import { expect } from 'bun:test';
import type { SignedInMember } from './harness';

export interface RecognitionCredential {
  provider: 'anthropic' | 'openai';
  baseURL: string | null;
  model: string | null;
  apiKeyLastFour: string;
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
}

export interface RecognitionStatus {
  available: boolean;
  source: 'household' | 'instance' | null;
  quota: { monthly: number; used: number; resetsOn: string } | null;
  householdAdmin: boolean;
  householdCredentials: boolean;
  credential: RecognitionCredential | null;
}

export interface StartedRecognition {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  error: string | null;
}

export const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A PNG as far as the upload's content sniffing looks; `rest` tells screenshots apart.
export function screenshot(...rest: number[]) {
  return new Uint8Array([...pngSignature, ...rest]);
}

export function upload(m: SignedInMember, bytes = screenshot(), name = 'order.png', type = 'image/png') {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return m.request('/api/recognitions', { method: 'POST', body: form });
}

export async function startRecognition(m: SignedInMember, bytes = screenshot()) {
  const res = await upload(m, bytes);
  expect(res.status).toBe(201);
  return (await res.json()) as StartedRecognition;
}

// Polls the way the web app does until the recognition has finished.
export async function finished<T extends StartedRecognition = StartedRecognition>(m: SignedInMember, id: string) {
  for (let i = 0; i < 200; i++) {
    const res = await m.request(`/api/recognitions/${id}`);
    expect(res.status).toBe(200);
    const recognition = (await res.json()) as T;
    if (recognition.status !== 'pending') return recognition;
    await Bun.sleep(10);
  }
  throw new Error(`recognition ${id} is still pending`);
}

export async function recognize(m: SignedInMember) {
  return finished(m, (await startRecognition(m)).id);
}

export async function statusOf(m: SignedInMember) {
  const res = await m.request('/api/recognizer');
  expect(res.status).toBe(200);
  return (await res.json()) as RecognitionStatus;
}
