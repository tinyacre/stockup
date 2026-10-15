import { expect, test } from './test';
import { founder } from './founder';

test('a member signs in and out', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill('wrong-password');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('alert')).toHaveText('用户名或密码错误');

  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText(founder.householdName)).toBeVisible();

  await page.reload();
  await expect(page.getByText(founder.householdName)).toBeVisible();

  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
});
