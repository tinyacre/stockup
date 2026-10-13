import { expect, test, type APIRequestContext } from '@playwright/test';
import { formatStockLineGap, formatYuan } from '../src/lib/format';
import { founder } from './founder';

async function post<T>(request: APIRequestContext, path: string, data: object, method = 'POST'): Promise<T> {
  const res = await request.fetch(path, { method, data });
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
}

test('a member prices a product from the home page and keeps it as seen only', async ({ page }) => {
  // Desktop and phone runs share one household, so every name carries a run-specific suffix.
  const suffix = crypto.randomUUID().slice(0, 6);
  const channelName = `楼下超市 ${suffix}`;
  const productName = `得宝抽纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  const search = page.getByRole('searchbox', { name: '搜索商品' });
  await expect(search).toBeVisible();

  // The catalog is seeded through the API; building it through the UI is covered elsewhere.
  const channel = await post<{ id: string }>(page.request, '/api/channels', { name: channelName });
  const group = await post<{ id: string }>(page.request, '/api/category-groups', { name: `生活用品 ${suffix}` });
  const category = await post<{ id: string }>(page.request, '/api/categories', {
    name: `抽纸 ${suffix}`,
    categoryGroupId: group.id,
  });
  const product = await post<{ id: string }>(page.request, '/api/products', {
    categoryId: category.id,
    name: productName,
    pricingUnit: { dimension: 'count', name: '抽' },
    baseSize: 90,
  });
  await post(page.request, `/api/products/${product.id}`, { stockLine: 400 }, 'PATCH');
  await post(page.request, '/api/price-records', {
    productId: product.id,
    channelId: channel.id,
    date: '2025-06-18',
    purchased: true,
    listPrice: 5990,
    discounts: [],
    quantity: 18,
    size: { amount: 130, unit: { dimension: 'count', name: '抽' } },
  });
  await page.reload();

  await search.fill(`dbcz${suffix}`);
  await page.getByRole('region', { name: '搜索结果' }).getByRole('button', { name: productName }).click();
  await expect(page.getByRole('heading', { name: productName })).toBeVisible();

  const references = page.getByRole('list', { name: '参考单价' });
  const options = page.getByRole('region', { name: '保存选项' });
  await options.getByLabel('日期').fill('2026-09-01');
  await expect(references.getByRole('listitem')).toHaveText(['历史最低2.30', '入手价4.00']);
  await options.getByLabel('日期').fill('2026-06-18');
  await expect(references.getByRole('listitem')).toHaveText(['历史最低2.30', '入手价4.00', '去年6182.30']);

  const form = page.getByRole('form', { name: '快速算价' });
  await form.getByLabel('原价').fill('99');
  await form.getByLabel('件数').fill('3×6');
  await expect(form).toContainText('共 18');
  await form.getByRole('button', { name: '130 抽' }).click();
  await expect(form.getByLabel('规格', { exact: true })).toHaveValue('130');
  await form.getByRole('button', { name: '加一项优惠' }).click();
  await form.getByLabel('优惠 1 金额').fill('10');

  const judgment = page.getByRole('status', { name: '判断' });
  await expect(judgment).toContainText('囤');
  await expect(judgment).toContainText('3.42元 / 90 抽');
  await expect(judgment).toContainText('比入手价便宜 14.4%，到手 ¥89.00');

  await options.getByRole('radio', { name: channelName }).click();
  await expect(options.getByRole('radio', { name: '仅记录' })).toBeChecked();
  await expect(options.getByLabel('大促')).toHaveValue(/.+/);
  await page.getByRole('button', { name: '存为仅记录' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已存为仅记录' })).toBeVisible();

  await page.getByRole('button', { name: '查看记录' }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${product.id}$`));
  const records = page
    .getByRole('list', { name: '价格记录列表' })
    .getByRole('listitem', { name: new RegExp(`^\\d{4}-\\d{2}-\\d{2} ${channelName}$`) });
  await expect(records).toHaveCount(2);
  const record = page.getByRole('listitem', { name: `2026-06-18 ${channelName}` });
  await expect(record).toContainText('仅记录');
  await expect(record).toContainText('618');
  await expect(record).toContainText('单价 ¥3.42 / 90 抽');
  await expect(record).toContainText('原价 ¥99.00 − 优惠 ¥10.00 · 18 件 × 130 抽');
});

test('pricing without saving leaves no record', async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const productName = `维达卷纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  const search = page.getByRole('searchbox', { name: '搜索商品' });
  await expect(search).toBeVisible();

  const group = await post<{ id: string }>(page.request, '/api/category-groups', { name: `生活用品 ${suffix}` });
  const category = await post<{ id: string }>(page.request, '/api/categories', {
    name: `卷纸 ${suffix}`,
    categoryGroupId: group.id,
  });
  const product = await post<{ id: string }>(page.request, '/api/products', {
    categoryId: category.id,
    name: productName,
    pricingUnit: { dimension: 'count', name: '卷' },
    baseSize: 1,
  });
  await page.reload();

  await search.fill(productName);
  await page.getByRole('region', { name: '搜索结果' }).getByRole('button', { name: productName }).click();
  await expect(page.getByRole('list', { name: '参考单价' })).toHaveCount(0);
  await expect(page.getByText('还没有价格记录。')).toBeVisible();
  await page.getByRole('form', { name: '快速算价' }).getByLabel('原价').fill('39.9');
  await expect(page.getByRole('status', { name: '判断' })).toContainText('无参考');

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '商品' }).click();
  const res = await page.request.get(`/api/price-records?productId=${product.id}`);
  expect(await res.json()).toEqual([]);
});

interface Judgment {
  netPrice: number;
  unitPrice: number;
  stockLine: number | null;
  lowestUnitPrice: number | null;
  promotion: { id: string; name: string } | null;
  lastYearPromotionLowest: number | null;
  verdict: 'recordLow' | 'stockUp' | 'skip' | 'noReference' | null;
  stockLineGap: number | null;
}

const badges = { recordLow: '史低', stockUp: '囤', skip: '不囤', noReference: '无参考' };

// The page judges in the browser for instant feedback; this keeps it in step with POST /judgments,
// which MCP and other clients use.
test('quick price shows the same judgment as the judgment API', async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const tissue = { dimension: 'count', name: '抽' };

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  const search = page.getByRole('searchbox', { name: '搜索商品' });
  await expect(search).toBeVisible();

  const channel = await post<{ id: string }>(page.request, '/api/channels', { name: `京东 ${suffix}` });
  const group = await post<{ id: string }>(page.request, '/api/category-groups', { name: `生活用品 ${suffix}` });
  const category = await post<{ id: string }>(page.request, '/api/categories', {
    name: `抽纸 ${suffix}`,
    categoryGroupId: group.id,
  });
  async function createProduct(name: string, stockLine: number | null, recordedPrices: [string, number][]) {
    const product = await post<{ id: string }>(page.request, '/api/products', {
      categoryId: category.id,
      name,
      pricingUnit: tissue,
      baseSize: 90,
    });
    if (stockLine !== null) await post(page.request, `/api/products/${product.id}`, { stockLine }, 'PATCH');
    for (const [date, listPrice] of recordedPrices) {
      await post(page.request, '/api/price-records', {
        productId: product.id,
        channelId: channel.id,
        date,
        purchased: true,
        listPrice,
        discounts: [],
        quantity: 18,
        size: { amount: 130, unit: tissue },
      });
    }
    return { id: product.id, name };
  }
  // Lowest unit prices: ¥2.30 last 618 and ¥3.04 in March; the stock line is ¥4.00.
  const withStockLine = await createProduct(`得宝抽纸 ${suffix}`, 400, [
    ['2025-06-18', 5990],
    ['2026-03-01', 7900],
  ]);
  const withoutStockLine = await createProduct(`维达抽纸 ${suffix}`, null, [['2026-03-01', 7900]]);
  const unrecorded = await createProduct(`清风抽纸 ${suffix}`, null, []);
  await page.reload();

  // Covers every verdict, a judgment without one, the stock line and lowest boundaries, and last year's promotion.
  const cases = [
    { product: withStockLine, listPrice: 99, discount: 10, quantity: '3×6', size: 130, date: '2026-06-18' },
    { product: withStockLine, listPrice: 49, discount: 0, quantity: '18', size: 130, date: '2026-06-18' },
    { product: withStockLine, listPrice: 129, discount: 0, quantity: '3×6', size: 130, date: '2026-09-01' },
    { product: withStockLine, listPrice: 59.9, discount: 0, quantity: '18', size: 130, date: '2026-06-18' },
    { product: withoutStockLine, listPrice: 99, discount: 0, quantity: '18', size: 130, date: '2026-09-01' },
    { product: withoutStockLine, listPrice: 39, discount: 5, quantity: '2×9', size: 100, date: '2026-09-01' },
    { product: unrecorded, listPrice: 19.9, discount: 0, quantity: '1', size: 90, date: '2026-06-18' },
  ];

  const form = page.getByRole('form', { name: '快速算价' });
  const options = page.getByRole('region', { name: '保存选项' });
  const judgmentOutput = page.getByRole('status', { name: '判断' });
  let picked: string | undefined;
  for (const c of cases) {
    if (picked !== c.product.id) {
      await search.fill(c.product.name);
      await page.getByRole('region', { name: '搜索结果' }).getByRole('button', { name: c.product.name }).click();
      await expect(page.getByRole('heading', { name: c.product.name })).toBeVisible();
      picked = c.product.id;
    }
    await options.getByLabel('日期').fill(c.date);
    await form.getByLabel('原价').fill(String(c.listPrice));
    await form.getByLabel('件数').fill(c.quantity);
    await form.getByLabel('规格', { exact: true }).fill(String(c.size));
    const removeDiscount = form.getByRole('button', { name: '移除优惠 1' });
    if (await removeDiscount.isVisible()) await removeDiscount.click();
    if (c.discount) {
      await form.getByRole('button', { name: '加一项优惠' }).click();
      await form.getByLabel('优惠 1 金额').fill(String(c.discount));
    }

    const res = await page.request.post('/api/judgments', {
      data: {
        productId: c.product.id,
        date: c.date,
        listPrice: Math.round(c.listPrice * 100),
        discounts: c.discount ? [{ amount: c.discount * 100 }] : [],
        quantity: c.quantity.split('×').reduce((n, f) => n * Number(f), 1),
        size: { amount: c.size, unit: tissue },
      },
    });
    expect(res.ok()).toBe(true);
    const judgment = (await res.json()) as Judgment;

    const gap =
      judgment.stockLineGap === null
        ? `到手 ${formatYuan(judgment.netPrice)}${judgment.verdict === null ? '，未设入手价' : ''}`
        : `${formatStockLineGap(judgment.stockLineGap)}，到手 ${formatYuan(judgment.netPrice)}`;
    const badge = judgment.verdict ? badges[judgment.verdict] : '—';
    await expect(judgmentOutput, JSON.stringify(c)).toHaveText(
      `${badge}${(judgment.unitPrice / 100).toFixed(2)}元 / 90 抽${gap}`,
    );

    const references = [
      judgment.lowestUnitPrice !== null && `历史最低${(judgment.lowestUnitPrice / 100).toFixed(2)}`,
      judgment.stockLine !== null && `入手价${(judgment.stockLine / 100).toFixed(2)}`,
      judgment.lastYearPromotionLowest !== null &&
        `去年${judgment.promotion!.name}${(judgment.lastYearPromotionLowest / 100).toFixed(2)}`,
    ].filter((r) => r !== false);
    const list = page.getByRole('list', { name: '参考单价' });
    if (references.length === 0) await expect(list, JSON.stringify(c)).toHaveCount(0);
    else await expect(list.getByRole('listitem'), JSON.stringify(c)).toHaveText(references);
  }
});
