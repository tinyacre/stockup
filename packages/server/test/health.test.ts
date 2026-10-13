import { describe, expect, test } from 'bun:test';
import { useTestApp } from './support/harness';

const ctx = useTestApp();

describe('GET /api/health', () => {
  test('reports ok when the database is reachable', async () => {
    const res = await ctx.app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
