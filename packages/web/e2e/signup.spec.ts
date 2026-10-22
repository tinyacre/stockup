import { latestCode } from './mail';
import { expect, test } from './test';

test('a visitor registers with an emailed code and signs in again with the email', async ({ page }) => {
  const id = crypto.randomUUID().slice(0, 8);
  const visitor = { email: `visitor_${id}@example.com`, username: `visitor_${id}`, password: `password-${id}` };

  await page.goto('/');
  await page.getByRole('link', { name: '没有账号？注册' }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.getByLabel('邮箱').fill(visitor.email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByRole('status')).toContainText('验证码已发送');
  await expect(page.getByRole('button', { name: /秒后重发/ })).toBeDisabled();

  await page.getByLabel('验证码').fill(await latestCode(page.request, visitor.email));
  await page.getByLabel('显示名称').fill('小新');
  await page.getByLabel('用户名').fill(visitor.username);
  await page.getByLabel('密码').fill(visitor.password);
  await page.getByRole('button', { name: '注册', exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(`${visitor.username} 的家`)).toBeVisible();
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '成员' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '家庭' })).toHaveCount(0);

  await page.getByRole('button', { name: '登出' }).click();
  await page.getByLabel('用户名或邮箱').fill(visitor.email);
  await page.getByLabel('密码').fill(visitor.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText(`${visitor.username} 的家`)).toBeVisible();
});
