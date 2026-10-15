import { defineConfig, devices } from '@playwright/test';
import type { ThemeOptions } from './e2e/test';

const port = Number(process.env.STOCKUP_E2E_PORT ?? 4173);

export default defineConfig<ThemeOptions>({
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
    { name: 'onboarding', testMatch: /\.setup\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'desktop',
      dependencies: ['onboarding'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, theme: 'tool' },
    },
    { name: 'phone', dependencies: ['onboarding'], use: { ...devices['Pixel 7'], theme: 'tool' } },
    {
      name: 'desktop-price-tag',
      dependencies: ['onboarding'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        theme: 'price-tag',
        serviceWorkers: 'block',
      },
    },
    {
      name: 'phone-price-tag',
      dependencies: ['onboarding'],
      use: { ...devices['Pixel 7'], theme: 'price-tag', serviceWorkers: 'block' },
    },
  ],
  webServer: {
    command: 'bun run build && bun ../server/test/support/e2e-server.ts',
    env: { STOCKUP_PORT: String(port), STOCKUP_BASE_URL: `http://127.0.0.1:${port}`, STOCKUP_WEB_DIR: 'dist' },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 60_000,
  },
});
