import type { Page } from '@playwright/test';
import { latestCode } from './mail';
import { expect, test, type Household } from './test';

async function signInAsAdmin(page: Page, household: Household) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(household.admin.username);
  await page.getByLabel('密码').fill(household.admin.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '邀请' }).click();
  await expect(page).toHaveURL(/\/invitations$/);
}

// The link is read from this run's own response.
async function generateLink(page: Page) {
  await page.getByLabel('有效期').selectOption('1');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/invitations') && r.request().method() === 'POST'),
    page.getByRole('button', { name: '生成邀请链接' }).click(),
  ]);
  const { id } = (await response.json()) as { id: string };
  const link = new URL(`/join/${id}`, page.url()).toString();
  await expect(linkItem(page, link)).toBeVisible();
  return link;
}

function linkItem(page: Page, link: string) {
  return page
    .getByRole('list', { name: '待使用的邀请' })
    .getByRole('listitem')
    .filter({ has: page.locator(`input[value="${link}"]`) });
}

async function verifyEmail(page: Page, email: string) {
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByRole('status')).toContainText('验证码已发送');
  await page.getByLabel('验证码').fill(await latestCode(page.request, email));
}

test('an invited family member verifies an email, registers and joins the household', async ({ page, household }) => {
  const username = `invitee_${crypto.randomUUID().slice(0, 6)}`;
  await signInAsAdmin(page, household);
  const link = await generateLink(page);
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();

  await page.goto(link);
  await expect(page.getByText(`加入「${household.name}」`)).toBeVisible();
  await verifyEmail(page, `${username}@example.com`);
  await page.getByLabel('显示名称').fill('小红');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('invitee-password');
  await page.getByRole('button', { name: '注册并加入' }).click();

  await expect(page.getByText(household.name)).toBeVisible();
  await expect(page.getByText('小红')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '商品' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '邀请' })).toHaveCount(0);

  await page.goto(link);
  await expect(page.getByRole('alert')).toContainText(`当前账号已属于「${household.name}」`);
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('alert')).toContainText('邀请链接已被使用');
});

test('an email another account has is refused with a message', async ({ page, household }) => {
  const id = crypto.randomUUID().slice(0, 8);
  const taken = {
    email: `taken_${id}@example.com`,
    username: `taken_${id}`,
    password: `password-${id}`,
    name: '已注册',
  };
  expect(
    (await page.request.post('/api/email-codes', { data: { email: taken.email, purpose: 'register' } })).status(),
  ).toBe(204);
  const signedUp = await page.request.post('/api/signup', {
    data: { ...taken, code: await latestCode(page.request, taken.email) },
  });
  expect(signedUp.status()).toBe(201);
  await page.context().clearCookies();

  await signInAsAdmin(page, household);
  const link = await generateLink(page);
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();

  await page.goto(link);
  await verifyEmail(page, taken.email);
  await page.getByLabel('显示名称').fill('小明');
  await page.getByLabel('用户名').fill(`invitee_${id}`);
  await page.getByLabel('密码').fill('invitee-password');
  await page.getByRole('button', { name: '注册并加入' }).click();
  await expect(page.getByRole('alert')).toContainText('邮箱已被其他账号使用');
});

test('a revoked link can no longer be used', async ({ page, household }) => {
  await signInAsAdmin(page, household);
  const link = await generateLink(page);
  await linkItem(page, link).getByRole('button', { name: '作废' }).click();
  await expect(linkItem(page, link)).toHaveCount(0);
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();

  await page.goto(link);
  await expect(page.getByRole('alert')).toContainText('邀请链接已作废');
});
