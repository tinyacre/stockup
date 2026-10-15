import { expect, test } from './test';
import { founder } from './founder';

// The e2e server starts empty and can be set up only once, so this runs before every other project.
test('the first visitor sets up the instance', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('家庭名称').fill(founder.householdName);
  await page.getByLabel('显示名称').fill(founder.name);
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '创建并进入' }).click();

  await expect(page.getByText(founder.householdName)).toBeVisible();
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
});
