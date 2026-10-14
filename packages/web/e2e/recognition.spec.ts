import { expect, test } from '@playwright/test';
import { founder } from './founder';

// A 1 × 1 PNG.
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// The e2e server's fake recognizer reads every screenshot as the same two lines of goods.
test('a member uploads a screenshot and sees its recognition drafts', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '识别' }).click();
  await page.getByLabel('上传截图').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: pixel });

  await expect(page).toHaveURL(/\/recognitions\/[^/]+$/);
  const screenshot = page.getByRole('img', { name: '上传的截图' });
  await expect.poll(() => screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const drafts = page.getByRole('region', { name: '识别草稿' });
  await expect(drafts.getByRole('heading')).toHaveText('识别草稿（2 条）');
  await expect(drafts).toContainText('日期 2026-06-18 · 渠道 京东 · 整单优惠 满 199 减 20 ¥20.00');
  await expect(drafts.getByRole('listitem', { name: '得宝抽纸 M码' })).toContainText(
    '100 抽 · 18 件 · 原价 ¥99.00 · plus 券 -¥10.00',
  );
  await expect(drafts.getByRole('listitem', { name: '皇家猫粮' })).toContainText('2 kg · 1 件 · 原价 ¥259.00');

  await page.reload();
  await expect(drafts.getByRole('listitem')).toHaveCount(2);
});

test('a screenshot that is not an image is refused', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '识别' }).click();
  await page.getByLabel('上传截图').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByRole('alert')).toHaveText('截图只支持 PNG、JPEG、WebP 或 GIF 图片。');
});

test.describe('without a recognizer', () => {
  // The e2e server always has the fake recognizer, so the server's answer is stood in for here;
  // the service worker would otherwise serve the request out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  test('recognition shows as unavailable', async ({ page }) => {
    await page.route('**/api/recognizer', (route) => route.fulfill({ json: { available: false } }));
    await page.goto('/');
    await page.getByLabel('用户名').fill(founder.username);
    await page.getByLabel('密码').fill(founder.password);
    await page.getByRole('button', { name: '登录' }).click();

    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '识别' }).click();
    await expect(page.getByRole('alert')).toHaveText('还没有配置识别服务，暂时不能识别截图。');
    await expect(page.getByLabel('上传截图')).toBeDisabled();
  });
});
