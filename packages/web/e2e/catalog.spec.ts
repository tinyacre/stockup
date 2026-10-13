import { expect, test } from '@playwright/test';
import { founder } from './founder';

test('a member builds and browses the catalog', async ({ page }) => {
  // Desktop and phone runs share one household, so every name carries a run-specific suffix.
  const suffix = crypto.randomUUID().slice(0, 6);
  const groupName = `宠物 ${suffix}`;
  const categoryName = `猫砂 ${suffix}`;
  const productName = `豆腐猫砂 ${suffix}`;

  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByLabel('新大类名称').fill(groupName);
  await page.getByRole('button', { name: '新建大类' }).click();
  const group = page.getByRole('group', { name: `大类 ${groupName}` });
  await expect(group).toBeVisible();

  await group.getByRole('button', { name: `在 ${groupName} 下新建品类` }).click();
  await group.getByLabel('新品类名称').fill(categoryName);
  await group.getByRole('button', { name: '新建品类', exact: true }).click();
  await expect(page.getByRole('heading', { name: categoryName })).toBeVisible();

  await page.getByRole('button', { name: '新建商品' }).click();
  const form = page.getByRole('form', { name: '新建商品' });
  await form.getByLabel('商品名称').fill(productName);
  await form.getByLabel('计价单位').selectOption({ label: 'kg' });
  await form.getByLabel('基准规格').fill('6');
  await form.getByLabel('备注').fill('原味和绿茶味都算');
  await form.getByRole('button', { name: '创建商品' }).click();

  const product = page.getByRole('listitem', { name: productName });
  await expect(product).toContainText('基准规格 6 kg');
  await expect(product).toContainText('原味和绿茶味都算');

  await page.getByRole('button', { name: `删除品类 ${categoryName}` }).click();
  await page.getByRole('button', { name: `确认删除品类 ${categoryName}` }).click();
  await expect(page.getByRole('alert')).toHaveText('品类下还有商品，请先删除或移走这些商品。');

  await product.getByRole('button', { name: '编辑' }).click();
  await product.getByLabel('商品名称').fill(`${productName} 加大`);
  await product.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('listitem', { name: `${productName} 加大` })).toBeVisible();

  // The selected category is kept in the history entry, so a reload shows it again.
  await page.reload();
  await expect(page.getByRole('heading', { name: categoryName })).toBeVisible();
  await expect(page.getByRole('listitem', { name: `${productName} 加大` })).toContainText('基准规格 6 kg');
});
