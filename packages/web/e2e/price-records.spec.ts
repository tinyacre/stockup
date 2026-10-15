import { expect, test } from './test';

test('a member records, edits and deletes prices on a product page', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const channelName = `山姆 ${suffix}`;
  const groupName = `宠物 ${suffix}`;
  const categoryName = `猫粮 ${suffix}`;
  const productName = `渴望猫粮 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
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
  await expect(page.getByRole('heading', { name: productName })).toBeVisible();

  await page.getByRole('button', { name: '记录价格' }).click();
  const form = page.getByRole('form', { name: '新建价格记录' });
  await form.getByLabel('日期').fill('2026-06-18');
  await form.getByLabel('渠道').selectOption({ label: channelName });
  await form.getByRole('radio', { name: '仅记录' }).click();
  await form.getByLabel('原价（元）').fill('509');
  await form.getByLabel('优惠 1 金额（元）').fill('40');
  await form.getByLabel('优惠 1 名称').fill('会员券');
  await form.getByRole('button', { name: '添加优惠' }).click();
  await form.getByLabel('优惠 2 金额（元）').fill('10');
  await form.getByLabel('件数').fill('2 × 1');
  await expect(form).toContainText('共 2 件');
  await form.getByLabel('每件规格').fill('11.9');
  await form.getByLabel('规格单位').selectOption('磅');
  await form.getByLabel('备注').fill('618 囤货');
  const preview = form.getByRole('status', { name: '价格预览' });
  await expect(preview).toContainText('到手价 ¥459.00');
  await expect(preview).toContainText('单价 ¥42.52 / 1 kg');
  await form.getByRole('button', { name: '保存记录' }).click();

  const record = page.getByRole('listitem', { name: `2026-06-18 ${channelName}` });
  await expect(record).toContainText('仅记录');
  await expect(record).toContainText('单价 ¥42.52 / 1 kg');
  await expect(record).toContainText('到手价 ¥459.00');
  await expect(record).toContainText('2 件 × 5.398 kg（录入为 11.9 磅）');
  await expect(record).toContainText('会员券 ¥40.00');
  await expect(record).toContainText('618 囤货');
  await expect(record).toContainText(`录入人 ${household.admin.name}`);

  await page.getByRole('button', { name: '记录价格' }).click();
  const second = page.getByRole('form', { name: '新建价格记录' });
  await second.getByLabel('日期').fill('2026-11-11');
  await second.getByLabel('原价（元）').fill('459');
  await second.getByLabel('每件规格').fill('5.4');
  await second.getByRole('button', { name: '保存记录' }).click();
  const records = page.getByRole('list', { name: '价格记录列表' }).getByRole('listitem');
  await expect(records.first()).toHaveAccessibleName(new RegExp('^2026-11-11'));
  await expect(records.nth(1)).toHaveAccessibleName(new RegExp('^2026-06-18'));

  await record.getByRole('button', { name: '编辑' }).click();
  await record.getByLabel('原价（元）').fill('499');
  await record.getByRole('button', { name: '保存' }).click();
  // The form's live preview shows the new price too, so the saved record is read once the form closes.
  await expect(record.getByRole('form')).toHaveCount(0);
  await expect(record).toContainText('到手价 ¥449.00');

  await page.reload();
  await expect(record).toContainText('到手价 ¥449.00');
  await record.getByRole('button', { name: `删除 2026-06-18 ${channelName} 的价格记录` }).click();
  await record.getByRole('button', { name: `确认删除 2026-06-18 ${channelName} 的价格记录` }).click();
  await expect(record).toHaveCount(0);
  await expect(records).toHaveCount(1);
});
