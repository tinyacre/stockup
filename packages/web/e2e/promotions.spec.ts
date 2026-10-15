import { expect, test } from './test';

test('a member adjusts promotions and sees them tag price records', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const month = '07';
  const promotionName = `周年庆 ${suffix}`;
  const channelName = `山姆 ${suffix}`;
  const groupName = `生活用品 ${suffix}`;
  const categoryName = `抽纸 ${suffix}`;
  const productName = `得宝抽纸 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '大促' }).click();
  await expect(page).toHaveURL(/\/promotions$/);
  const promotions = page.getByRole('list', { name: '大促列表' });
  await expect(promotions.getByRole('listitem', { name: '618' })).toContainText('05-31 至 06-20');

  const newPromotion = page.getByRole('form', { name: '新建大促' });
  await newPromotion.getByLabel('新大促名称').fill(promotionName);
  await newPromotion.getByLabel('开始（月-日）').fill(`${month}-10`);
  await newPromotion.getByLabel('结束（月-日）').fill(`${month}-32`);
  await newPromotion.getByRole('button', { name: '新建大促' }).click();
  await expect(newPromotion.getByRole('alert')).toContainText('月-日');
  await newPromotion.getByLabel('结束（月-日）').fill(`${month}-12`);
  await newPromotion.getByRole('button', { name: '新建大促' }).click();
  const promotion = promotions.getByRole('listitem', { name: promotionName });
  await expect(promotion).toContainText(`${month}-10 至 ${month}-12`);

  await promotion.getByRole('button', { name: '修改范围' }).click();
  await promotion.getByLabel('开始（月-日）').fill(`${month}-01`);
  await promotion.getByLabel('结束（月-日）').fill(`${month}-05`);
  await promotion.getByRole('button', { name: '保存范围' }).click();
  await expect(promotion).toContainText(`${month}-01 至 ${month}-05`);
  await page.reload();
  await expect(promotion).toContainText(`${month}-01 至 ${month}-05`);

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
  await productForm.getByLabel('计价单位').selectOption({ label: 'kg' });
  await productForm.getByLabel('基准规格').fill('1');
  await productForm.getByRole('button', { name: '创建商品' }).click();
  await page.getByRole('link', { name: productName }).click();

  async function recordPrice(date: string, listPrice: string) {
    await page.getByRole('button', { name: '记录价格' }).click();
    const form = page.getByRole('form', { name: '新建价格记录' });
    await form.getByLabel('日期').fill(date);
    await form.getByLabel('渠道').selectOption({ label: channelName });
    await form.getByLabel('原价（元）').fill(listPrice);
    await form.getByLabel('每件规格').fill('1');
    return form;
  }

  const lastYear = await recordPrice(`2025-${month}-03`, '2.80');
  await expect(lastYear.getByLabel('大促').locator('option:checked')).toHaveText(promotionName);
  await lastYear.getByRole('button', { name: '保存记录' }).click();
  const lastYearRecord = page.getByRole('listitem', { name: `2025-${month}-03 ${channelName}` });
  await expect(lastYearRecord.getByLabel('大促')).toHaveText(promotionName);

  const thisYear = await recordPrice(`2026-${month}-04`, '3.00');
  await expect(thisYear.getByRole('status', { name: '价格预览' })).toContainText(
    `去年${promotionName}最低单价 ¥2.80 / 1 kg`,
  );
  // Outside every range the tag follows the date to none, and the member can pick one by hand.
  await thisYear.getByLabel('日期').fill(`2026-${month}-20`);
  await expect(thisYear.getByLabel('大促')).toHaveValue('');
  await thisYear.getByLabel('大促').selectOption({ label: promotionName });
  await thisYear.getByRole('button', { name: '保存记录' }).click();
  const thisYearRecord = page.getByRole('listitem', { name: `2026-${month}-20 ${channelName}` });
  await expect(thisYearRecord.getByLabel('大促')).toHaveText(promotionName);

  await lastYearRecord.getByRole('button', { name: '编辑' }).click();
  await lastYearRecord.getByLabel('大促').selectOption({ label: '无' });
  await lastYearRecord.getByRole('button', { name: '保存' }).click();
  await expect(lastYearRecord.getByRole('form')).toHaveCount(0);
  await page.reload();
  await expect(lastYearRecord).toBeVisible();
  await expect(lastYearRecord.getByLabel('大促')).toHaveCount(0);
});
