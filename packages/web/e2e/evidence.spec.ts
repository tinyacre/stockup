import { expect, test } from './test';
import { founder } from './founder';

// A 1 × 1 PNG.
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('a member attaches screenshots to a price record, views and deletes them', async ({ page }) => {
  // Desktop and phone runs share one household, so every name carries a run-specific suffix.
  const suffix = crypto.randomUUID().slice(0, 6);
  const channelName = `京东 ${suffix}`;
  const groupName = `生活用品 ${suffix}`;
  const categoryName = `抽纸 ${suffix}`;
  const productName = `得宝抽纸 ${suffix}`;

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

  await page.getByRole('button', { name: '新建商品' }).click();
  const productForm = page.getByRole('form', { name: '新建商品' });
  await productForm.getByLabel('商品名称').fill(productName);
  await productForm.getByLabel('计数单位名称').fill('抽');
  await productForm.getByLabel('基准规格').fill('90');
  await productForm.getByRole('button', { name: '创建商品' }).click();
  await page.getByRole('link', { name: productName }).click();

  await page.getByRole('button', { name: '记录价格' }).click();
  const form = page.getByRole('form', { name: '新建价格记录' });
  await form.getByLabel('日期').fill('2026-06-18');
  await form.getByLabel('渠道').selectOption({ label: channelName });
  await form.getByLabel('原价（元）').fill('99');
  await form.getByLabel('每件规格').fill('130');
  await form.getByRole('button', { name: '保存记录' }).click();

  const label = `2026-06-18 ${channelName}`;
  const record = page.getByRole('listitem', { name: label });
  await record.getByLabel(`给 ${label} 添加凭证`).setInputFiles([
    { name: 'order.png', mimeType: 'image/png', buffer: pixel },
    { name: 'page.png', mimeType: 'image/png', buffer: pixel },
  ]);
  const first = record.getByRole('img', { name: `${label} 的凭证 1` });
  await expect(first).toBeVisible();
  await expect(record.getByRole('img', { name: `${label} 的凭证 2` })).toBeVisible();
  await expect.poll(() => first.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  await record.getByLabel(`给 ${label} 添加凭证`).setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(record.getByRole('alert')).toHaveText('凭证只支持 PNG、JPEG、WebP 或 GIF 图片。');

  await page.reload();
  await record.getByRole('button', { name: `删除 ${label} 的凭证 2` }).click();
  await record.getByRole('button', { name: `确认删除 ${label} 的凭证 2` }).click();
  await expect(record.getByRole('img')).toHaveCount(1);
});
