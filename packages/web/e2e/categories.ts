import { expect, type Page } from '@playwright/test';

// Sets a group and its categories up on the 分类 page, then opens 商品 and returns the group in its category tree.
export async function createGroup(page: Page, groupName: string, categoryNames: string[] = []) {
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '分类' }).click();
  await page.getByRole('button', { name: '新建大类' }).click();
  await page.getByLabel('新大类名称').fill(groupName);
  await page.getByRole('button', { name: '新建大类' }).click();
  const settings = page.getByRole('group', { name: `大类 ${groupName}` });
  for (const name of categoryNames) {
    await settings.getByRole('button', { name: `在 ${groupName} 下新建品类` }).click();
    await settings.getByLabel('新品类名称').fill(name);
    await settings.getByRole('button', { name: '新建品类', exact: true }).click();
    await expect(settings.getByRole('listitem', { name })).toBeVisible();
  }
  await nav.getByRole('link', { name: '商品' }).click();
  return page.getByRole('region', { name: '大类与品类' }).getByRole('group', { name: `大类 ${groupName}` });
}
