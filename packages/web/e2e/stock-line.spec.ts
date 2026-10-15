import { expect, test } from './test';
import { founder } from './founder';

test('a member sets a stock line and sees the judgment while recording a price', async ({ page }) => {
  // Desktop and phone runs share one household, so every name carries a run-specific suffix.
  const suffix = crypto.randomUUID().slice(0, 6);
  const channelName = `京东 ${suffix}`;
  const groupName = `米面粮油 ${suffix}`;
  const categoryName = `大米 ${suffix}`;
  const productName = `五常大米 ${suffix}`;

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
  await productForm.getByLabel('计价单位').selectOption({ label: 'kg' });
  await productForm.getByLabel('基准规格').fill('1');
  await productForm.getByRole('button', { name: '创建商品' }).click();
  await page.getByRole('link', { name: productName }).click();

  const stockLine = page.getByRole('region', { name: '入手价' });
  await expect(stockLine).toContainText('入手价 未设置');
  await expect(stockLine).toContainText('历史最低单价 暂无');

  await page.getByRole('button', { name: '记录价格' }).click();
  const first = page.getByRole('form', { name: '新建价格记录' });
  await first.getByLabel('渠道').selectOption({ label: channelName });
  await first.getByLabel('原价（元）').fill('100');
  await first.getByLabel('每件规格').fill('1');
  await expect(first.getByRole('status', { name: '价格预览' })).toContainText('暂无参考');
  await first.getByRole('button', { name: '保存记录' }).click();
  await expect(stockLine).toContainText('历史最低单价 ¥100.00 / 1 kg');

  await stockLine.getByRole('button', { name: '设置入手价' }).click();
  const stockLineForm = stockLine.getByRole('form', { name: '设置入手价' });
  await expect(stockLineForm).toContainText('历史最低单价 ¥100.00 / 1 kg');
  await expect(stockLineForm).toContainText(`${channelName} ¥100.00 / 1 kg`);
  await stockLineForm.getByLabel('入手价（元 / 1 kg）').fill('110');
  await stockLineForm.getByRole('button', { name: '保存入手价' }).click();
  await expect(stockLine).toContainText('入手价 ¥110.00 / 1 kg');

  await page.getByRole('button', { name: '记录价格' }).click();
  const form = page.getByRole('form', { name: '新建价格记录' });
  const preview = form.getByRole('status', { name: '价格预览' });
  await form.getByLabel('每件规格').fill('1');
  await form.getByLabel('原价（元）').fill('115');
  await expect(preview).toContainText('不囤比入手价贵 4.5%');
  await form.getByLabel('原价（元）').fill('110');
  await expect(preview).toContainText('囤与入手价持平');
  await expect(preview).not.toContainText('不囤');
  // Equal to the Lowest Unit Price is not a record low.
  await form.getByLabel('原价（元）').fill('100');
  await expect(preview).toContainText('囤比入手价便宜 9.1%');
  await form.getByLabel('原价（元）').fill('80');
  await expect(preview).toContainText('史低比入手价便宜 27.3%');
  await form.getByRole('button', { name: '取消' }).click();

  await page.reload();
  await expect(stockLine).toContainText('入手价 ¥110.00 / 1 kg');
  await stockLine.getByRole('button', { name: '修改入手价' }).click();
  await stockLine.getByRole('button', { name: '清除入手价' }).click();
  await expect(stockLine).toContainText('入手价 未设置');

  await page.getByRole('button', { name: '记录价格' }).click();
  await form.getByLabel('每件规格').fill('1');
  await form.getByLabel('原价（元）').fill('120');
  await expect(preview).toContainText('未设入手价，不低于历史最低单价');
});
