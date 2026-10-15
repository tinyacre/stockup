import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './test';
import { founder } from './founder';

async function post<T>(request: APIRequestContext, path: string, data: object, method = 'POST'): Promise<T> {
  const res = await request.fetch(path, { method, data });
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
}

const tissue = { dimension: 'count', name: '抽' };

// Offline support is the service worker, so this runs with it even in projects that block it,
// and then shows the theme the account chose.
test.use({ serviceWorkers: 'allow' });

test('offline, a member prices a cached product as online and saves once back online', async ({ page, context }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const productName = `得宝抽纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('searchbox', { name: '搜索商品' })).toBeVisible();

  const channel = await post<{ id: string }>(page.request, '/api/channels', { name: `山姆 ${suffix}` });
  const group = await post<{ id: string }>(page.request, '/api/category-groups', { name: `生活用品 ${suffix}` });
  const category = await post<{ id: string }>(page.request, '/api/categories', {
    name: `抽纸 ${suffix}`,
    categoryGroupId: group.id,
  });
  const product = await post<{ id: string }>(page.request, '/api/products', {
    categoryId: category.id,
    name: productName,
    pricingUnit: tissue,
    baseSize: 90,
  });
  await post(page.request, `/api/products/${product.id}`, { stockLine: 400 }, 'PATCH');
  const record = (date: string, listPrice: number) =>
    post(page.request, '/api/price-records', {
      productId: product.id,
      channelId: channel.id,
      date,
      purchased: true,
      listPrice,
      discounts: [],
      quantity: 18,
      size: { amount: 130, unit: tissue },
    });
  await record('2025-06-18', 5990);

  // The service worker caches what the page reads once it controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜索商品' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const form = page.getByRole('form', { name: '快速算价' });
  const options = page.getByRole('region', { name: '保存选项' });
  const judgment = page.getByRole('status', { name: '判断' });
  const references = page.getByRole('list', { name: '参考单价' }).getByRole('listitem');
  async function priceIt() {
    await page.getByRole('searchbox', { name: '搜索商品' }).fill(`dbcz${suffix}`);
    await page.getByRole('region', { name: '搜索结果' }).getByRole('button', { name: productName }).click();
    await expect(page.getByRole('heading', { name: productName })).toBeVisible();
    await options.getByLabel('日期').fill('2026-06-18');
    await form.getByLabel('原价').fill('99');
    await form.getByLabel('件数').fill('3×6');
    await form.getByRole('button', { name: '130 抽' }).click();
  }

  await priceIt();
  await expect(references).toHaveText(['历史最低2.30', '入手价4.00', '去年6182.30']);
  const online = await judgment.textContent();
  expect(online).toContain('囤¥3.81 / 90 抽');

  await context.setOffline(true);
  await page.reload();
  await priceIt();
  await expect(references).toHaveText(['历史最低2.30', '入手价4.00', '去年6182.30']);
  await expect(judgment).toHaveText(online!);

  const save = page.getByRole('button', { name: '联网后保存' });
  await expect(save).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: '联网后才能保存' })).toBeVisible();
  await form.getByLabel('原价').press('Enter');
  await expect(page.getByRole('alert')).toContainText('联网后再存');
  await expect(form.getByLabel('原价')).toHaveValue('99');

  // Another member records a lower price while this device is offline.
  await record('2026-04-01', 4990);
  await context.setOffline(false);
  await expect(references).toHaveText(['历史最低1.92', '入手价4.00', '去年6182.30']);
  await expect(form.getByLabel('原价')).toHaveValue('99');
  await page.getByRole('button', { name: '存为仅记录' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已存为仅记录' })).toBeVisible();
});
