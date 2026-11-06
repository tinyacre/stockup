import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const env = process.env;

function required(name: string) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required when GLITCHTIP_AUTH_TOKEN is set`);
  return value;
}

// With GLITCHTIP_AUTH_TOKEN set (the image build), the bundle gets debug ids and hidden source maps, which are
// uploaded to GlitchTip as release STOCKUP_RELEASE and then deleted from dist. Without it, no source map is built.
const uploadSourceMaps = Boolean(env.GLITCHTIP_AUTH_TOKEN);

function sourceMapUpload() {
  return sentryVitePlugin({
    // The plugin's own usage reporting goes to sentry.io.
    telemetry: false,
    url: required('GLITCHTIP_URL'),
    org: required('GLITCHTIP_ORG'),
    project: required('GLITCHTIP_PROJECT'),
    authToken: env.GLITCHTIP_AUTH_TOKEN,
    // GlitchTip's API sits behind Cloudflare Access; only its ingest paths are open.
    headers: {
      'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID'),
      'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET'),
    },
    // The bundle names its release from /api/capabilities, which the server reads from the same STOCKUP_RELEASE.
    release: { name: required('STOCKUP_RELEASE'), inject: false, setCommits: false, deploy: false },
    errorHandler: (error) => {
      throw error;
    },
  });
}

// Hidden source maps are built only to be uploaded, which the Sentry plugin does in writeBundle; this runs after it.
// The plugin's own deleteSourcemapsAfterUpload leaves them in dist under Vite 8.
function deleteHiddenSourceMaps(): Plugin {
  let outDir = '';
  let hidden = false;
  return {
    name: 'stockup:delete-hidden-source-maps',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      hidden = config.build.sourcemap === 'hidden';
    },
    closeBundle: {
      order: 'post',
      handler() {
        if (!hidden) return;
        for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.map')) rmSync(path.join(entry.parentPath, entry.name));
        }
      },
    },
  };
}

const telemetryModule = /[\\/]node_modules[\\/](@tinyacre[\\/]telemetry|@sentry)[\\/]/;

export default defineConfig({
  build: {
    sourcemap: uploadSourceMaps ? 'hidden' : false,
    rolldownOptions: {
      output: {
        // Telemetry code gets a directory of its own, which the service worker leaves out of its precache, so a
        // device that reports nothing never downloads it.
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => telemetryModule.test(id))
            ? 'assets/telemetry/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
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
        background_color: '#f6f5f2',
        theme_color: '#f6f5f2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        globIgnores: ['**/node_modules/**/*', 'assets/telemetry/**'],
        // The service worker would otherwise follow build.sourcemap, and its maps are never uploaded.
        sourcemap: false,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//, /^\/mcp$/],
        runtimeCaching: [
          {
            // Offline, the app opens on the household data it last read. Auth endpoints carry no data worth replaying,
            // Evidence images are too large to keep without bound, a recognition is polled for its latest status,
            // and whether recognition is available matters only online, where it must reflect the server's setup now.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin &&
              url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/api/auth/') &&
              !url.pathname.startsWith('/api/evidence/') &&
              !url.pathname.startsWith('/api/recognitions/') &&
              url.pathname !== '/api/recognizer',
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
    uploadSourceMaps && sourceMapUpload(),
    deleteHiddenSourceMaps(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/.well-known': 'http://127.0.0.1:8080',
      '/mcp': 'http://127.0.0.1:8080',
    },
  },
});
