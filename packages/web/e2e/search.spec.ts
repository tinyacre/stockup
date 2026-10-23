import { expect, test } from './test';

test('a member finds a product by its pinyin initials', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const groupName = `生活用品 ${suffix}`;
  const categoryName = `抽纸 ${suffix}`;
  const productName = `得宝抽纸 ${suffix}`;

  await page.goto('/products');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByLabel('新大类名称').fill(groupName);
  await page.getByRole('button', { name: '新建大类' }).click();
  const group = page.getByRole('group', { name: `大类 ${groupName}` });
  await group.getByRole('button', { name: `在 ${groupName} 下新建品类` }).click();
  await group.getByLabel('新品类名称').fill(categoryName);
  await group.getByRole('button', { name: '新建品类', exact: true }).click();
  await group.getByRole('button', { name: categoryName }).click();

  await page.getByRole('button', { name: '新建商品' }).click();
  const form = page.getByRole('form', { name: '新建商品' });
  await form.getByLabel('商品名称').fill(productName);
  await form.getByLabel('计数单位名称').fill('抽');
  await form.getByLabel('基准规格').fill('90');
  await form.getByRole('button', { name: '创建商品' }).click();
  await expect(page.getByRole('listitem', { name: productName })).toBeVisible();

  await page.getByRole('searchbox', { name: '搜索商品' }).fill(`dbcz${suffix}`);
  const results = page.getByRole('region', { name: '搜索结果' });
  const found = results.getByRole('listitem', { name: productName });
  await expect(found).toContainText(`${groupName} / ${categoryName} · 基准规格 90 抽`);

  await found.getByRole('link', { name: productName }).click();
  await expect(page.getByRole('heading', { name: productName })).toBeVisible();

  // The query is kept in the history entry, so going back shows the same results.
  await page.goBack();
  await expect(page.getByRole('searchbox', { name: '搜索商品' })).toHaveValue(`dbcz${suffix}`);
  await expect(results.getByRole('listitem', { name: productName })).toBeVisible();

  await page.getByRole('searchbox', { name: '搜索商品' }).fill(`zzzz${suffix}`);
  await expect(results).toContainText(`未找到「zzzz${suffix}」相关的商品`);

  await page.getByRole('searchbox', { name: '搜索商品' }).fill('');
  await expect(results).toBeHidden();
});
