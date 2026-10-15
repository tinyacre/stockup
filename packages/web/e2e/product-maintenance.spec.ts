import type { Page } from '@playwright/test';
import { expect, test } from './test';
import { founder } from './founder';

async function createProduct(page: Page, name: string, unit: string, baseSize: string) {
  await page.getByRole('button', { name: '新建商品' }).click();
  const form = page.getByRole('form', { name: '新建商品' });
  await form.getByLabel('商品名称').fill(name);
  await form.getByLabel('计价单位').selectOption({ label: unit });
  await form.getByLabel('基准规格').fill(baseSize);
  await form.getByRole('button', { name: '创建商品' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

async function recordPrice(page: Page, channelName: string, listPrice: string, size: string) {
  await page.getByRole('button', { name: '记录价格' }).click();
  const form = page.getByRole('form', { name: '新建价格记录' });
  await form.getByLabel('渠道').selectOption({ label: channelName });
  await form.getByLabel('原价（元）').fill(listPrice);
  await form.getByLabel('每件规格').fill(size);
  await form.getByRole('button', { name: '保存记录' }).click();
  await expect(form).toBeHidden();
}

test('a member re-bases, merges and archives products', async ({ page }) => {
  // Desktop and phone runs share one household, so every name carries a run-specific suffix.
  const suffix = crypto.randomUUID().slice(0, 6);
  const channelName = `山姆 ${suffix}`;
  const groupName = `宠物 ${suffix}`;
  const categoryName = `猫粮 ${suffix}`;
  const kept = `渴望猫粮 ${suffix}`;
  const duplicate = `渴望 六种鱼 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();

  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '渠道' }).click();
  await page.getByLabel('新渠道名称').fill(channelName);
  await page.getByRole('button', { name: '新建渠道' }).click();
  await expect(page.getByRole('listitem', { name: channelName })).toBeVisible();

  await nav.getByRole('link', { name: '商品' }).click();
  await page.getByLabel('新大类名称').fill(groupName);
  await page.getByRole('button', { name: '新建大类' }).click();
  const group = page.getByRole('group', { name: `大类 ${groupName}` });
  await group.getByRole('button', { name: `在 ${groupName} 下新建品类` }).click();
  await group.getByLabel('新品类名称').fill(categoryName);
  await group.getByRole('button', { name: '新建品类', exact: true }).click();
  await createProduct(page, kept, 'g', '500');
  await createProduct(page, duplicate, 'kg', '1');

  const backToCategory = () =>
    page.getByRole('navigation', { name: '路径' }).getByRole('button', { name: categoryName }).click();
  const maintain = async (action: string) => {
    await page.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: action }).click();
  };

  await page.getByRole('link', { name: duplicate }).click();
  await recordPrice(page, channelName, '300', '5.4');
  await backToCategory();
  await page.getByRole('link', { name: kept }).click();
  await recordPrice(page, channelName, '100', '2000');
  const records = page.getByRole('list', { name: '价格记录列表' });
  await expect(records).toContainText('单价 ¥25.00 / 500 g');

  await maintain('修改计价单位和基准规格');
  const units = page.getByRole('form', { name: '修改计价单位和基准规格' });
  await units.getByLabel('计价单位').selectOption('kg');
  await expect(units.getByLabel('基准规格')).toHaveValue('0.5');
  await units.getByLabel('基准规格').fill('1');
  await units.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('计价单位 kg · 基准规格 1 kg')).toBeVisible();
  await expect(records).toContainText('1 件 × 2 kg（录入为 2000 g）');
  await expect(records).toContainText('单价 ¥50.00 / 1 kg');

  await maintain('合并重复商品');
  const merge = page.getByRole('form', { name: '合并重复商品' });
  await merge.getByLabel(`要并入「${kept}」的重复商品`).selectOption({ label: `${duplicate}（1 kg）` });
  await merge.getByRole('button', { name: '合并' }).click();
  await merge.getByRole('button', { name: `确认合并并删除「${duplicate}」` }).click();
  await expect(merge).toBeHidden();
  await expect(records.getByRole('listitem')).toHaveCount(2);
  await expect(records).toContainText('单价 ¥55.56 / 1 kg');

  await maintain('归档商品');
  await expect(page.getByText('已归档', { exact: true })).toBeVisible();
  await backToCategory();
  await expect(page.getByRole('link', { name: duplicate })).toHaveCount(0);
  await expect(page.getByRole('link', { name: kept })).toHaveCount(0);
  await page.getByText('已归档的商品（1）').click();
  await page.getByRole('list', { name: '已归档的商品列表' }).getByRole('link', { name: kept }).click();
  await maintain('取消归档');
  await expect(page.getByText('已归档', { exact: true })).toBeHidden();
  await backToCategory();
  await expect(page.getByRole('link', { name: kept })).toBeVisible();
});
