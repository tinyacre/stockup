import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { useTestApp } from './support/harness';

const webDir = mkdtempSync(path.join(tmpdir(), 'stockup-web-'));
writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>StockUp</title>');
mkdirSync(path.join(webDir, 'assets'));
writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log(1)');

const ctx = useTestApp({ webDir });

describe('web bundle hosting', () => {
  test('serves the app shell at the root', async () => {
    const res = await ctx.app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>StockUp</title>');
  });

  test('serves built assets', async () => {
    const res = await ctx.app.request('/assets/app.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1)');
  });

  test('answers client-side routes with the app shell', async () => {
    const res = await ctx.app.request('/products/some-id');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>StockUp</title>');
  });

  test('answers unknown API paths with a JSON 404', async () => {
    const res = await ctx.app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  test('answers missing assets with 404 rather than the app shell', async () => {
    const res = await ctx.app.request('/assets/missing.js');
    expect(res.status).toBe(404);
  });
});
