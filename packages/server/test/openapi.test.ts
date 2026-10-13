import { describe, expect, test } from 'bun:test';
import { useTestApp } from './support/harness';

const ctx = useTestApp();

describe('OpenAPI document', () => {
  test('describes every registered API route', async () => {
    const res = await ctx.app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toStartWith('3.');
    expect(doc.paths).toHaveProperty(['/api/health', 'get']);
  });

  test('serves an interactive reference page', async () => {
    const res = await ctx.app.request('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('/api/openapi.json');
  });
});
