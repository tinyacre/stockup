import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './test';
import { formatStockLineGap, formatYuan } from '../src/lib/format';

async function post<T>(request: APIRequestContext, path: string, data: object, method = 'POST'): Promise<T> {
  const res = await request.fetch(path, { method, data });
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
}

test('a member prices a product from the home page and keeps it as seen only', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const channelName = `楼下超市 ${suffix}`;
  const productName = `得宝抽纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
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
  await expect(references.getByRole('listitem')).toHaveText(['历史最低 · 去年6182.30', '入手价4.00']);

  const form = page.getByRole('form', { name: '录入价格' });
  await form.getByLabel('原价').fill('99');
  await form.getByLabel('件数').fill('3×6');
  await expect(form).toContainText('共 18');
  await form.getByRole('button', { name: '130 抽' }).click();
  await expect(form.getByLabel('规格', { exact: true })).toHaveValue('130');
  await form.getByRole('button', { name: '添加优惠' }).click();
  await form.getByLabel('优惠 1 金额').fill('10');

  const judgment = page.getByRole('status', { name: '判断' });
  await expect(judgment).toContainText('囤');
  await expect(judgment).toContainText('¥3.42 / 90 抽');
  await expect(judgment).toContainText('比入手价便宜 14.4%，到手 ¥89.00');

  await options.getByRole('radio', { name: channelName }).click();
  await expect(options.getByRole('radio', { name: '仅记录' })).toBeChecked();
  await expect(options.getByLabel('大促')).toHaveValue(/.+/);
  await page.getByRole('button', { name: '存为仅记录' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已存为仅记录' })).toBeVisible();

  await page.getByRole('link', { name: '查看记录' }).click();
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

test('pricing without saving leaves no record', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const productName = `维达卷纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
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
  await expect(page.getByText('暂无价格记录')).toBeVisible();
  await page.getByRole('form', { name: '录入价格' }).getByLabel('原价').fill('39.9');
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

const badges = { recordLow: '史低', stockUp: '囤', skip: '不囤', noReference: '暂无参考' };

// The page judges in the browser for instant feedback; this keeps it in step with POST /judgments,
// which MCP and other clients use.
test('quick price shows the same judgment as the judgment API', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const tissue = { dimension: 'count', name: '抽' };

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
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

  const form = page.getByRole('form', { name: '录入价格' });
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
      await form.getByRole('button', { name: '添加优惠' }).click();
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
    // The output reads the verdict, the unit price and the gap first, then the price breakdown.
    const head = `${badge}¥${(judgment.unitPrice / 100).toFixed(2)} / 90 抽${gap}`;
    const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(judgmentOutput, JSON.stringify(c)).toHaveText(new RegExp(`^${escaped}(原价|$)`));

    // References at the same price share one label.
    const marks = [
      { label: '历史最低', value: judgment.lowestUnitPrice },
      { label: '入手价', value: judgment.stockLine },
      { label: `去年${judgment.promotion?.name}`, value: judgment.lastYearPromotionLowest },
    ].filter((m): m is { label: string; value: number } => m.value !== null);
    const references = marks
      .filter((m, i) => marks.findIndex((other) => other.value === m.value) === i)
      .map((m) => {
        const labels = marks.filter((other) => other.value === m.value).map((other) => other.label);
        return `${labels.join(' · ')}${(m.value / 100).toFixed(2)}`;
      });
    const list = page.getByRole('list', { name: '参考单价' });
    if (references.length === 0) await expect(list, JSON.stringify(c)).toHaveCount(0);
    else await expect(list.getByRole('listitem'), JSON.stringify(c)).toHaveText(references);
  }
});

test('a wide screen shows the product list, the form and the result side by side', async ({
  page,
  household,
}, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'the three columns need a wide screen');
  const suffix = crypto.randomUUID().slice(0, 6);
  const productName = `洁柔面巾纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('searchbox', { name: '搜索商品' })).toBeVisible();

  const group = await post<{ id: string }>(page.request, '/api/category-groups', { name: `生活用品 ${suffix}` });
  const category = await post<{ id: string }>(page.request, '/api/categories', {
    name: `面巾纸 ${suffix}`,
    categoryGroupId: group.id,
  });
  await post(page.request, '/api/products', {
    categoryId: category.id,
    name: productName,
    pricingUnit: { dimension: 'count', name: '抽' },
    baseSize: 100,
  });
  await page.reload();

  const list = page.getByRole('region', { name: '商品列表' });
  await list.getByRole('button', { name: productName }).click();
  await expect(page.getByRole('heading', { name: productName })).toBeVisible();

  const form = page.getByRole('form', { name: '录入价格' });
  const result = page.getByRole('region', { name: '判断结果' });
  await expect(list).toBeVisible();
  await expect(form).toBeVisible();
  await expect(result).toBeVisible();
  await expect(result.getByRole('status', { name: '判断' })).toBeVisible();
  await expect(result.getByRole('button', { name: '存为仅记录' })).toBeVisible();
  const [left, middle, right] = await Promise.all([list.boundingBox(), form.boundingBox(), result.boundingBox()]);
  expect(left!.x + left!.width).toBeLessThanOrEqual(middle!.x);
  expect(middle!.x + middle!.width).toBeLessThanOrEqual(right!.x);
});

test('a member prices and saves with the keyboard alone', async ({ page, household }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'keyboard pricing is for computers');
  const suffix = crypto.randomUUID().slice(0, 6);
  const productName = `得宝抽纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();
  const search = page.getByRole('searchbox', { name: '搜索商品' });
  await expect(search).toBeVisible();

  await post(page.request, '/api/channels', { name: `楼下超市 ${suffix}` });
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
  await page.reload();
  await expect(search).toBeVisible();

  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await page.keyboard.type(`dbcz${suffix}`);
  await expect(page.getByRole('region', { name: '搜索结果' }).getByRole('button', { name: productName })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: productName })).toBeVisible();

  const form = page.getByRole('form', { name: '录入价格' });
  await expect(form.getByLabel('原价')).toBeFocused();
  await page.keyboard.type('99');
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('件数')).toBeFocused();
  await page.keyboard.type('3*6');
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('规格', { exact: true })).toBeFocused();
  await page.keyboard.type('130');
  await expect(page.getByRole('status', { name: '判断' })).toContainText('¥3.81 / 90 抽');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: '已存为仅记录' })).toBeVisible();

  const res = await page.request.get(`/api/price-records?productId=${product.id}`);
  const records = (await res.json()) as { listPrice: number; quantity: number; purchased: boolean }[];
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ listPrice: 9900, quantity: 18, purchased: false });
});

test('a member creates a product that search misses and goes on pricing it', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const productName = `心相印湿巾 ${suffix}`;
  const categoryName = `湿巾 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();
  const search = page.getByRole('searchbox', { name: '搜索商品' });
  await expect(search).toBeVisible();

  const group = await post<{ id: string }>(page.request, '/api/category-groups', { name: `生活用品 ${suffix}` });
  await post(page.request, '/api/categories', { name: categoryName, categoryGroupId: group.id });
  await page.reload();

  await search.fill(productName);
  const results = page.getByRole('region', { name: '搜索结果' });
  await results.getByRole('button', { name: `新建「${productName}」` }).click();

  const create = page.getByRole('form', { name: '新建商品' });
  await expect(create.getByLabel('商品名称')).toHaveValue(productName);
  await create.getByLabel('所属品类').selectOption({ label: categoryName });
  await create.getByLabel('计数单位名称').fill('片');
  await create.getByLabel('基准规格').fill('80');
  await create.getByRole('button', { name: '创建商品' }).click();

  await expect(page.getByRole('heading', { name: productName })).toBeVisible();
  await expect(search).toHaveValue('');
  await page.getByRole('form', { name: '录入价格' }).getByLabel('原价').fill('19.9');
  await expect(page.getByRole('status', { name: '判断' })).toContainText('无参考');
  await expect(page.getByRole('status', { name: '判断' })).toContainText('¥19.90 / 80 片');
});
