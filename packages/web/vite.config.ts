import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'StockUp',
        short_name: 'StockUp',
        description: '家庭共享的好价记忆工具',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f3f4f0',
        theme_color: '#f3f4f0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Offline, the app opens on the household data it last read. Auth endpoints carry no data worth replaying,
            // and Evidence images are too large to keep without bound.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin &&
              url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/api/auth/') &&
              !url.pathname.startsWith('/api/evidence/'),
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              // A weak signal in a shop is as good as offline.
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  // Lets the page tell a cached answer from a fresh one, so it can read again once the network works.
                  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
                    if (!cachedResponse) return cachedResponse;
                    const headers = new Headers(cachedResponse.headers);
                    headers.set('x-stockup-from-cache', '1');
                    return new Response(cachedResponse.body, {
                      status: cachedResponse.status,
                      statusText: cachedResponse.statusText,
                      headers,
                    });
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
