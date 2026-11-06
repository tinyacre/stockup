import type { Browser, BrowserContext, Page, Request } from '@playwright/test';
import type { Capabilities } from '../src/lib/api';
import { expect, test } from './test';

// Requests a service worker answers bypass page.route, and these tests watch every request the page makes.
test.use({ serviceWorkers: 'block' });

async function signIn(page: Page, account: { username: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(account.username);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

const openSection = (page: Page, name: string) =>
  page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name }).click();

const isTelemetry = (url: string) => /\/_s\/|\/_e\/|\/assets\/telemetry\//.test(new URL(url).pathname);

// Answers the capabilities as an instance with telemetry configured would, records each pageview sent, and
// swallows error envelopes.
async function routeTelemetry(target: Page | BrowserContext, pageviews: string[]) {
  await target.route('**/api/capabilities', async (route) => {
    const response = await route.fetch();
    const capabilities = (await response.json()) as Capabilities;
    await route.fulfill({
      response,
      json: {
        ...capabilities,
        telemetry: {
          release: 'e2e',
          umami: { endpoint: '/_s/api/send', websiteId: 'e2e-site', hostname: 'stockup.example.com' },
          sentry: {
            dsn: 'https://e2ekey@errors.example.com/4',
            tunnel: '/_e/api/4/envelope/?sentry_key=e2ekey',
          },
        },
      },
    });
  });
  await target.route('**/_s/api/send', async (route) => {
    const { payload } = route.request().postDataJSON() as { payload: { url: string } };
    pageviews.push(payload.url);
    await route.fulfill({ json: {} });
  });
  await target.route('**/_e/**', (route) => route.fulfill({ json: {} }));
}

function recordTelemetryRequests(context: BrowserContext) {
  const sent: string[] = [];
  context.on('request', (request) => isTelemetry(request.url()) && sent.push(new URL(request.url()).pathname));
  return sent;
}

// A context of its own, so the device cache and the session start empty.
const newDevice = (browser: Browser) => browser.newContext({ serviceWorkers: 'block' });

async function turnOffForAccount(browser: Browser, account: { username: string; password: string }) {
  const context = await newDevice(browser);
  const signedIn = await context.request.post('/api/auth/sign-in/username', {
    data: { username: account.username, password: account.password },
  });
  expect(signedIn.ok()).toBe(true);
  expect((await context.request.patch('/api/me', { data: { telemetryEnabled: false } })).ok()).toBe(true);
  return context;
}

test('an instance without telemetry loads none of its code and sends nothing', async ({ page, household, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await signIn(page, household.admin);
  await openSection(page, '商品');
  await openSection(page, '设置');
  await expect(page.getByRole('region', { name: '主题' })).toBeVisible();

  expect(requests.filter(isTelemetry)).toEqual([]);
  expect(requests.filter((url) => new URL(url).origin !== new URL(baseURL!).origin)).toEqual([]);
  await expect(page.getByRole('region', { name: '帮助改进 StockUp' })).toHaveCount(0);
});

test.describe('an instance with telemetry', () => {
  const pageviews: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageviews.length = 0;
    await routeTelemetry(page, pageviews);
  });

  test('reports each page as its route template until the member turns the switch off', async ({ page, household }) => {
    await signIn(page, household.admin);
    await expect.poll(() => pageviews).toEqual(['/']);

    await openSection(page, '设置');
    await expect.poll(() => pageviews).toEqual(['/', '/settings']);

    const telemetrySwitch = page.getByRole('radiogroup', { name: '帮助改进 StockUp' });
    await expect(telemetrySwitch.getByRole('radio', { name: '开启' })).toBeChecked();
    await telemetrySwitch.getByRole('radio', { name: '关闭' }).click();
    await expect(telemetrySwitch.getByRole('radio', { name: '关闭' })).toBeChecked();

    const sent: Request[] = [];
    page.on('request', (request) => isTelemetry(request.url()) && sent.push(request));
    await openSection(page, '商品');
    await page.reload();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await openSection(page, '设置');
    await expect(telemetrySwitch.getByRole('radio', { name: '关闭' })).toBeChecked();
    expect(sent.map((request) => request.url())).toEqual([]);
    expect(pageviews).toEqual(['/', '/settings']);

    // Turned back on, the page open then counts as a new view.
    await telemetrySwitch.getByRole('radio', { name: '开启' }).click();
    await expect.poll(() => pageviews).toEqual(['/', '/settings', '/settings']);
  });

  test('a product page reports its template, never its id', async ({ page, household }) => {
    await signIn(page, household.admin);
    const id = '0b6c3f0e-6d55-4b8e-9f0e-5d3c1f2a7b90';
    await page.goto(`/products/${id}`);
    await expect.poll(() => pageviews.at(-1)).toBe('/products/:id');
    expect(pageviews.filter((url) => url.includes(id))).toEqual([]);
  });

  test('an account that turned it off sends nothing on a device whose cache still has it on', async ({
    browser,
    household,
  }) => {
    const context = await turnOffForAccount(browser, household.admin);
    await context.addInitScript(() => localStorage.setItem('tinyacre.telemetry.enabled', '1'));
    await routeTelemetry(context, pageviews);
    const sent = recordTelemetryRequests(context);

    const page = await context.newPage();
    await page.goto('/products');
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(sent).toEqual([]);
    expect(pageviews).toEqual([]);
    await context.close();
  });

  test('an error thrown while an account that turned it off is signing in sends nothing', async ({
    browser,
    household,
  }) => {
    await (await turnOffForAccount(browser, household.admin)).close();

    const context = await newDevice(browser);
    await context.addInitScript(() => localStorage.setItem('tinyacre.telemetry.enabled', '1'));
    await routeTelemetry(context, pageviews);
    const sent = recordTelemetryRequests(context);
    // Holds back the account's choice until the error has had its chance to be reported.
    let gated = false;
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await context.route('**/api/me', async (route) => {
      if (gated) await released;
      await route.continue();
    });

    const page = await context.newPage();
    await page.goto('/');
    await expect.poll(() => pageviews).toEqual(['/']);
    await expect.poll(() => sent.some((path) => path.startsWith('/assets/telemetry/sentry-'))).toBe(true);

    gated = true;
    await page.getByLabel('用户名').fill(household.admin.username);
    await page.getByLabel('密码').fill(household.admin.password);
    const accountRequested = page.waitForRequest('**/api/me');
    await page.getByRole('button', { name: '登录' }).click();
    await accountRequested;
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('thrown during sign-in');
      }),
    );
    await page.waitForTimeout(500);
    release();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(sent.filter((path) => path.startsWith('/_e/'))).toEqual([]);
    expect(pageviews).toEqual(['/']);
    await context.close();
  });
});
