import { expect, test } from './test';
import { founder } from './founder';

test('a member adds, renames, archives and restores channels', async ({ page }) => {
  // Desktop and phone runs share one household, so every name carries a run-specific suffix.
  const suffix = crypto.randomUUID().slice(0, 6);
  const name = `天猫 ${suffix}`;
  const renamed = `天猫超市 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '渠道' }).click();
  await expect(page).toHaveURL(/\/channels$/);

  await page.getByLabel('新渠道名称').fill(name);
  await page.getByRole('button', { name: '新建渠道' }).click();
  const active = page.getByRole('list', { name: '使用中的渠道' });
  const channel = active.getByRole('listitem', { name });
  await expect(channel).toBeVisible();

  await page.getByLabel('新渠道名称').fill(name);
  await page.getByRole('button', { name: '新建渠道' }).click();
  await expect(page.getByRole('alert')).toContainText('名称已被使用');

  await channel.getByRole('button', { name: `重命名 ${name}` }).click();
  await channel.getByLabel('渠道名称').fill(renamed);
  await channel.getByRole('button', { name: '保存' }).click();
  const renamedChannel = active.getByRole('listitem', { name: renamed });
  await expect(renamedChannel).toBeVisible();

  await renamedChannel.getByRole('button', { name: '归档' }).click();
  const archived = page.getByRole('list', { name: '已归档的渠道列表' });
  await expect(archived.getByRole('listitem', { name: renamed })).toBeVisible();
  await expect(active.getByRole('listitem', { name: renamed })).toHaveCount(0);

  await page.reload();
  await expect(archived.getByRole('listitem', { name: renamed })).toBeVisible();
  await archived.getByRole('listitem', { name: renamed }).getByRole('button', { name: '恢复' }).click();
  await expect(active.getByRole('listitem', { name: renamed })).toBeVisible();
});
