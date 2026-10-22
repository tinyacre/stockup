import type { Page } from '@playwright/test';
import { expect, test } from './test';

test('pages show no challenge while the instance has no Turnstile keys', async ({ page }) => {
  const cloudflare: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'challenges.cloudflare.com') cloudflare.push(request.url());
  });
  await page.goto('/sign-up');
  await expect(page.getByRole('button', { name: '注册' })).toBeEnabled();
  await expect(page.getByTestId('turnstile')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '登录' })).toBeEnabled();
  await expect(page.getByTestId('turnstile')).toHaveCount(0);
  expect(cloudflare).toEqual([]);
});

test.describe('with Turnstile', () => {
  // The e2e server runs without keys, since the real widget would load from Cloudflare, so the site key and
  // Cloudflare's script are stood in for; the service worker would otherwise answer out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  // Renders a checkbox that passes with a token numbered by how many widgets this page has rendered.
  const fakeScript = `
    let rendered = 0;
    window.turnstile = {
      render(container, options) {
        const id = String(++rendered);
        const box = document.createElement('button');
        box.type = 'button';
        box.textContent = '确认是真人';
        box.onclick = () => options.callback('e2e-token-' + id);
        container.append(box);
        return id;
      },
      remove() {},
    };`;

  async function challenge(page: Page) {
    await page.route('**/api/capabilities', (route) =>
      route.fulfill({ json: { signup: true, email: true, turnstileSiteKey: 'e2e-site-key' } }),
    );
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: fakeScript }),
    );
  }

  test('sign-in waits for the challenge and asks again after a failed attempt', async ({ page, household }) => {
    await challenge(page);
    await page.goto('/');
    const submit = page.getByRole('button', { name: '登录' });
    await page.getByLabel('用户名或邮箱').fill(household.admin.username);
    await page.getByLabel('密码').fill('wrong-password');
    await expect(submit).toBeDisabled();

    await page.getByRole('button', { name: '确认是真人' }).click();
    const failed = page.waitForRequest('**/api/auth/sign-in/username');
    await submit.click();
    expect((await failed).headers()['x-turnstile-token']).toBe('e2e-token-1');
    await expect(page.getByText('用户名或密码错误')).toBeVisible();
    await expect(submit).toBeDisabled();

    await page.getByLabel('密码').fill(household.admin.password);
    await page.getByRole('button', { name: '确认是真人' }).click();
    const signedIn = page.waitForRequest('**/api/auth/sign-in/username');
    await submit.click();
    expect((await signedIn).headers()['x-turnstile-token']).toBe('e2e-token-2');
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();

    // Sending a code to change the email is challenged too, from the settings page.
    await page.goto('/settings');
    const panel = page.getByRole('region', { name: '邮箱' });
    await panel.getByLabel('新邮箱').fill(`${household.admin.username}@example.com`);
    const send = panel.getByRole('button', { name: '发送验证码' });
    await expect(send).toBeDisabled();
    await panel.getByRole('button', { name: '确认是真人' }).click();
    const sent = page.waitForRequest('**/api/email-codes');
    await send.click();
    expect((await sent).headers()['x-turnstile-token']).toMatch(/^e2e-token-/);
  });

  test('the MCP sign-in page is challenged as well', async ({ page }) => {
    await challenge(page);
    await page.goto('/oauth/sign-in?client_id=x');
    await expect(page.getByRole('button', { name: '确认是真人' })).toBeVisible();
    await expect(page.getByRole('button', { name: '登录' })).toBeDisabled();
  });

  test('sign-up, password reset and joining show the challenge', async ({ page, household, playwright, baseURL }) => {
    // The admin invites from another device, so this page stays signed out.
    const admin = await playwright.request.newContext({ baseURL });
    await admin.post('/api/auth/sign-in/username', {
      data: { username: household.admin.username, password: household.admin.password },
    });
    const { id } = (await (await admin.post('/api/invitations', { data: { expiresInDays: 1 } })).json()) as { id: string };
    await admin.dispose();

    await challenge(page);
    for (const path of ['/sign-up', '/reset-password', `/join/${id}`]) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: '确认是真人' })).toBeVisible();
      await expect(page.getByRole('button', { name: '发送验证码' })).toBeDisabled();
      await page.getByRole('button', { name: '确认是真人' }).click();
      await expect(page.getByRole('button', { name: '发送验证码' })).toBeEnabled();
    }
  });
});
