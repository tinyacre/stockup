import { expect, test, type APIRequestContext } from '@playwright/test';
import { founder } from './founder';

async function post<T>(request: APIRequestContext, path: string, data: object, method = 'POST'): Promise<T> {
  const res = await request.fetch(path, { method, data });
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
}

test('a member browses a category, then filters and charts a product’s price records', async ({ page }) => {
  // Desktop and phone runs share one household, so every name carries a run-specific suffix.
  const suffix = crypto.randomUUID().slice(0, 6);
  const groupName = `生活用品 ${suffix}`;
  const categoryName = `抽纸 ${suffix}`;
  const productName = `得宝抽纸 ${suffix}`;
  const otherName = `维达抽纸 ${suffix}`;
  const jd = `京东 ${suffix}`;
  const sams = `山姆 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('searchbox', { name: '搜索商品' })).toBeVisible();

  // The catalog is seeded through the API; building it through the UI is covered elsewhere.
  const jdChannel = await post<{ id: string }>(page.request, '/api/channels', { name: jd });
  const samsChannel = await post<{ id: string }>(page.request, '/api/channels', { name: sams });
  const group = await post<{ id: string }>(page.request, '/api/category-groups', { name: groupName });
  const category = await post<{ id: string }>(page.request, '/api/categories', {
    name: categoryName,
    categoryGroupId: group.id,
  });
  const newProduct = (name: string) =>
    post<{ id: string }>(page.request, '/api/products', {
      categoryId: category.id,
      name,
      pricingUnit: { dimension: 'count', name: '抽' },
      baseSize: 90,
    });
  const product = await newProduct(productName);
  await newProduct(otherName);
  await post(page.request, `/api/products/${product.id}`, { stockLine: 5000 }, 'PATCH');
  // One 90-sheet piece each, so every unit price equals its list price.
  for (const [date, channelId, purchased, listPrice, promotionId] of [
    ['2026-01-05', jdChannel.id, true, 9000, null],
    ['2026-06-18', jdChannel.id, true, 4500, undefined],
    ['2026-10-01', samsChannel.id, false, 6000, null],
  ] as const) {
    await post(page.request, '/api/price-records', {
      productId: product.id,
      channelId,
      date,
      purchased,
      listPrice,
      promotionId,
      discounts: [],
      quantity: 1,
      size: { amount: 90, unit: { dimension: 'count', name: '抽' } },
    });
  }

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '商品' }).click();
  await page.getByRole('group', { name: `大类 ${groupName}` }).getByRole('button', { name: categoryName }).click();
  const summary = page.getByRole('listitem', { name: productName }).getByRole('definition');
  await expect(summary).toHaveText(['¥50.00 / 90 抽', '¥45.00 / 90 抽', '¥60.00 / 90 抽 2026-10-01']);
  await expect(page.getByRole('listitem', { name: otherName }).getByRole('definition')).toHaveText([
    '未设置',
    '暂无',
    '暂无',
  ]);

  await page.getByRole('link', { name: productName }).click();
  const chart = page.getByRole('figure', { name: '单价走势' });
  await expect(chart).toContainText('入手价 ¥50.00 / 90 抽');
  await expect(chart).toContainText('历史最低单价 ¥45.00 / 90 抽');
  await expect(chart.locator('.recharts-line-dots circle')).toHaveCount(3);

  const records = page.getByRole('list', { name: '价格记录列表' }).getByRole('listitem');
  const filters = page.getByRole('group', { name: '筛选价格记录' });
  await expect(records).toHaveCount(3);

  await filters.getByLabel('购买情况').selectOption({ label: '仅记录' });
  await expect(records).toHaveCount(1);
  await expect(records.first()).toHaveAccessibleName(`2026-10-01 ${sams}`);
  await expect(chart.locator('.recharts-line-dots circle')).toHaveCount(1);

  await filters.getByRole('button', { name: '清除筛选' }).click();
  await filters.getByLabel('渠道').selectOption({ label: jd });
  await expect(records).toHaveCount(2);
  await filters.getByLabel('大促').selectOption({ label: '非大促' });
  await expect(records).toHaveCount(1);
  await expect(records.first()).toHaveAccessibleName(`2026-01-05 ${jd}`);
  await filters.getByLabel('大促').selectOption({ label: '618' });
  await expect(records.first()).toHaveAccessibleName(`2026-06-18 ${jd}`);

  await filters.getByLabel('购买情况').selectOption({ label: '仅记录' });
  await expect(page.getByText('没有符合筛选条件的价格记录。')).toBeVisible();
  await expect(chart).toBeHidden();
  await filters.getByRole('button', { name: '清除筛选' }).click();
  await expect(records).toHaveCount(3);
});
