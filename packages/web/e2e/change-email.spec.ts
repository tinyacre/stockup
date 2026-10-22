import type { Page } from '@playwright/test';
import { latestCode } from './mail';
import { expect, test } from './test';

async function signIn(page: Page, login: string, password: string) {
  await page.goto('/');
  await page.getByLabel('用户名或邮箱').fill(login);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

test('a member without an email adds one in settings and signs in with it', async ({ page, household }) => {
  const { admin } = household;
  const email = `${admin.username}@example.com`;
  await signIn(page, admin.username, admin.password);
  await page.goto('/settings');

  const panel = page.getByRole('region', { name: '邮箱' });
  await expect(panel.getByText('未设置邮箱')).toBeVisible();
  await panel.getByLabel('新邮箱').fill(email);
  await panel.getByRole('button', { name: '发送验证码' }).click();
  await expect(panel.getByRole('status')).toContainText('验证码已发送');
  await panel.getByLabel('验证码').fill(await latestCode(page.request, email));
  await panel.getByRole('button', { name: '更换邮箱' }).click();
  await expect(panel.getByText('邮箱已更新')).toBeVisible();
  await expect(panel.getByText(email)).toBeVisible();

  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await signIn(page, email, admin.password);
  await expect(page.getByText(household.name)).toBeVisible();
});

test.describe('without mail', () => {
  // The e2e server can always mail, so the server's answer is stood in for here;
  // the service worker would otherwise serve the request out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  test('settings offer no email change when the instance cannot mail', async ({ page, household }) => {
    await page.route('**/api/capabilities', (route) =>
      route.fulfill({ json: { signup: false, email: false, turnstileSiteKey: null } }),
    );
    await signIn(page, household.admin.username, household.admin.password);
    const answered = page.waitForResponse('**/api/capabilities');
    await page.goto('/settings');
    await answered;
    await expect(page.getByRole('region', { name: '密码' })).toBeVisible();
    await expect(page.getByRole('region', { name: '邮箱' })).toHaveCount(0);
  });
});
