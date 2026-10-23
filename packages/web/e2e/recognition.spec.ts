import { expect, test } from './test';

// A 1 × 1 PNG.
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// The e2e server's fake recognizer reads every screenshot as the same two lines of goods.
test('a member uploads a screenshot and sees its recognition drafts', async ({ page, household }) => {
  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '识别' }).click();
  await page.getByLabel('上传截图').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: pixel });

  await expect(page).toHaveURL(/\/recognitions\/[^/]+$/);
  const screenshot = page.getByRole('img', { name: '上传的截图' });
  await expect.poll(() => screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const drafts = page.getByRole('region', { name: '识别草稿' });
  await expect(drafts.getByRole('heading')).toHaveText(/^识别草稿\s*2$/);
  await expect(drafts).toContainText('日期 2026-06-18 · 渠道 京东 · 整单优惠 满 199 减 20 ¥20.00');
  await expect(drafts.getByRole('listitem', { name: '得宝抽纸 M码' })).toContainText(
    '100 抽 · 18 件 · 原价 ¥99.00 · plus 券 -¥10.00',
  );
  await expect(drafts.getByRole('listitem', { name: '皇家猫粮' })).toContainText('2 kg · 1 件 · 原价 ¥259.00');

  await page.reload();
  await expect(drafts.getByRole('listitem')).toHaveCount(2);
});

test('a screenshot that is not an image is refused', async ({ page, household }) => {
  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '识别' }).click();
  await page.getByLabel('上传截图').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByRole('alert')).toHaveText('截图仅支持 PNG、JPEG、WebP、GIF');
});

test('a member matches, edits and confirms drafts into price records', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const channelName = `京东 ${suffix}`;
  const groupName = `生活用品 ${suffix}`;
  const categoryName = `抽纸 ${suffix}`;
  const tissueName = `得宝抽纸 ${suffix}`;
  const catFoodName = `皇家猫粮 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '渠道' }).click();
  await page.getByRole('button', { name: '新建渠道' }).click();
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
  await group.getByRole('button', { name: categoryName }).click();
  await page.getByRole('button', { name: '新建商品' }).click();
  const productForm = page.getByRole('form', { name: '新建商品' });
  await productForm.getByLabel('商品名称').fill(tissueName);
  await productForm.getByLabel('计数单位名称').fill('抽');
  await productForm.getByLabel('基准规格').fill('90');
  await productForm.getByRole('button', { name: '创建商品' }).click();
  await expect(page.getByRole('link', { name: tissueName })).toBeVisible();

  await nav.getByRole('link', { name: '识别' }).click();
  await page.getByLabel('上传截图').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: pixel });
  const drafts = page.getByRole('region', { name: '识别草稿' });
  const tissues = drafts.getByRole('listitem', { name: '得宝抽纸 M码' });
  const catFood = drafts.getByRole('listitem', { name: '皇家猫粮' });
  await expect(tissues).toContainText('整单优惠分摊 -¥5.53');
  await expect(catFood).toContainText('整单优惠分摊 -¥14.47');
  await expect(drafts).toContainText('整单优惠 ¥20.00 已按原价比例分摊');

  await tissues.getByRole('button', { name: /选择商品|更换商品/ }).click();
  await tissues.getByLabel('搜索商品').fill(tissueName);
  await tissues.getByRole('button', { name: tissueName }).click();
  await expect(tissues.getByRole('link', { name: tissueName })).toBeVisible();

  await catFood.getByRole('button', { name: /选择商品|更换商品/ }).click();
  await catFood.getByRole('button', { name: '新建商品' }).click();
  const newProduct = catFood.getByRole('form', { name: '新建商品' });
  await newProduct.getByLabel('商品名称').fill(catFoodName);
  await newProduct.getByLabel('所属品类').selectOption({ label: categoryName });
  await newProduct.getByLabel('计价单位').selectOption({ label: 'g' });
  await newProduct.getByLabel('基准规格').fill('1000');
  await newProduct.getByRole('button', { name: '创建商品' }).click();
  await expect(catFood.getByRole('link', { name: catFoodName })).toBeVisible();

  await tissues.getByRole('button', { name: '编辑' }).click();
  const edit = tissues.getByRole('form', { name: '编辑 得宝抽纸 M码' });
  await edit.getByLabel('件数').fill('24');
  await edit.getByLabel('整单优惠分摊（元）').fill('6');
  await edit.getByRole('button', { name: '保存' }).click();
  await expect(tissues).toContainText('100 抽 · 24 件 · 原价 ¥99.00 · plus 券 -¥10.00 · 整单优惠分摊 -¥6.00');
  await expect(drafts).toContainText('分摊合计 ¥20.47，与整单优惠 ¥20.00 不一致');

  const confirm = page.getByRole('form', { name: '确认入库' });
  await expect(confirm.getByLabel('日期')).toHaveValue('2026-06-18');
  await confirm.getByLabel('渠道').selectOption({ label: channelName });
  await confirm.getByRole('button', { name: '确认入库 2 条' }).click();

  const result = page.getByRole('region', { name: '入库结果' });
  await expect(result.getByRole('status')).toHaveText('已入库 2 条');
  await expect(result.getByRole('listitem').filter({ hasText: tissueName })).toContainText('到手价 ¥83.00');
  await expect(result.getByRole('listitem').filter({ hasText: catFoodName })).toContainText('到手价 ¥244.53');

  await result.getByRole('link', { name: catFoodName }).click();
  await expect(page.getByRole('listitem', { name: `2026-06-18 ${channelName}` })).toBeVisible();
});

test('deleting a draft shares the order discount over the rest', async ({ page, household }) => {
  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '识别' }).click();
  await page.getByLabel('上传截图').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: pixel });
  const drafts = page.getByRole('region', { name: '识别草稿' });
  await expect(drafts.getByRole('heading')).toHaveText(/^识别草稿\s*2$/);

  const catFood = drafts.getByRole('listitem', { name: '皇家猫粮' });
  await catFood.getByRole('button', { name: '删除 皇家猫粮' }).click();
  await catFood.getByRole('button', { name: '确认删除 皇家猫粮' }).click();
  await expect(drafts.getByRole('heading')).toHaveText(/^识别草稿\s*1$/);
  await expect(drafts.getByRole('listitem', { name: '得宝抽纸 M码' })).toContainText('整单优惠分摊 -¥20.00');
});

test.describe('without a recognizer', () => {
  // The e2e server always has the fake recognizer, so the server's answer is stood in for here;
  // the service worker would otherwise serve the request out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  test('recognition shows as unavailable', async ({ page, household }) => {
    await page.route('**/api/recognizer', (route) => route.fulfill({ json: { available: false } }));
    await page.goto('/');
    await page.getByLabel('用户名').fill(household.admin.username);
    await page.getByLabel('密码').fill(household.admin.password);
    await page.getByRole('button', { name: '登录' }).click();

    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '识别' }).click();
    await expect(page.getByRole('alert')).toHaveText('识别服务未配置');
    await expect(page.getByLabel('上传截图')).toBeDisabled();
  });
});
