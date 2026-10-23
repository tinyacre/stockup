import { expect, test } from './test';

test('a member builds and browses the catalog', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const groupName = `宠物 ${suffix}`;
  const categoryName = `猫砂 ${suffix}`;
  const productName = `豆腐猫砂 ${suffix}`;

  await page.goto('/products');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByLabel('新大类名称').fill(groupName);
  await page.getByRole('button', { name: '新建大类' }).click();
  const group = page.getByRole('group', { name: `大类 ${groupName}` });
  await expect(group).toBeVisible();

  await group.getByRole('button', { name: `在 ${groupName} 下新建品类` }).click();
  await group.getByLabel('新品类名称').fill(categoryName);
  await group.getByRole('button', { name: '新建品类', exact: true }).click();
  // Phones stay on the tree after creating a category, so the new one is opened from there.
  await group.getByRole('button', { name: categoryName }).click();
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
  await expect(page.getByText('品类下还有商品，无法删除')).toBeVisible();

  await product.getByRole('button', { name: '编辑' }).click();
  await product.getByLabel('商品名称').fill(`${productName} 加大`);
  await product.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('listitem', { name: `${productName} 加大` })).toBeVisible();

  // The selected category is kept in the history entry, so a reload shows it again.
  await page.reload();
  await expect(page.getByRole('heading', { name: categoryName })).toBeVisible();
  await expect(page.getByRole('listitem', { name: `${productName} 加大` })).toContainText('基准规格 6 kg');
});

test('a product goes straight into a group that has no categories', async ({ page, household }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const groupName = `日用品 ${suffix}`;
  const productName = `垃圾袋 ${suffix}`;

  await page.goto('/products');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByLabel('新大类名称').fill(groupName);
  await page.getByRole('button', { name: '新建大类' }).click();
  const group = page.getByRole('group', { name: `大类 ${groupName}` });
  await group.getByRole('button', { name: '未分品类' }).click();
  await expect(page.getByRole('heading', { name: '未分品类' })).toBeVisible();

  await page.getByRole('button', { name: '新建商品' }).click();
  const form = page.getByRole('form', { name: '新建商品' });
  await form.getByLabel('商品名称').fill(productName);
  await form.getByLabel('计数单位名称').fill('只');
  await form.getByLabel('基准规格').fill('100');
  await form.getByRole('button', { name: '创建商品' }).click();
  await expect(page.getByRole('listitem', { name: productName })).toContainText('基准规格 100 只');

  // A phone shows the category tree and the shelf one at a time.
  const back = page.getByRole('button', { name: groupName, exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: `删除大类 ${groupName}` }).click();
  await page.getByRole('button', { name: `确认删除大类 ${groupName}` }).click();
  await expect(page.getByText('大类下还有品类或商品，无法删除')).toBeVisible();
});
