import type { Page } from '@playwright/test';
import { expect, test } from './test';

// The account's own choice decides the theme here, so the project's override stays off.
test.use({ theme: null });

async function signIn(page: Page, account: { username: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(account.username);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

test('a member picks a theme in settings and it follows the account to other devices', async ({
  page,
  browser,
  household,
}) => {
  const account = household.admin;
  await signIn(page, account);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'tool');

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置' }).click();
  const theme = page.getByRole('radiogroup', { name: '主题' });
  await expect(theme.getByRole('radio', { name: '简洁' })).toBeChecked();
  await theme.getByRole('radio', { name: '醒目' }).click();
  await expect(html).toHaveAttribute('data-theme', 'price-tag');
  await expect(theme.getByRole('radio', { name: '醒目' })).toBeChecked();

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'price-tag');

  const other = await (await browser.newContext()).newPage();
  await signIn(other, account);
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'price-tag');
  await other.context().close();
});
