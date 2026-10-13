import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.out/results',
  reporter: [['list'], ['html', { outputFolder: './e2e/.out/report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'bun run build && bun ../server/test/support/e2e-server.ts',
    env: { STOCKUP_PORT: String(port), STOCKUP_WEB_DIR: 'dist' },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 60_000,
  },
});
