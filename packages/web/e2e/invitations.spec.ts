import type { Page } from '@playwright/test';
import { expect, test } from './test';
import { founder } from './founder';

async function signInAsFounder(page: Page) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '邀请' }).click();
  await expect(page).toHaveURL(/\/invitations$/);
}

// Desktop and phone runs share one household, so the link is read from this run's own response.
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

test('an invited family member registers and joins the household', async ({ page }) => {
  const username = `invitee_${crypto.randomUUID().slice(0, 6)}`;
  await signInAsFounder(page);
  const link = await generateLink(page);
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();

  await page.goto(link);
  await expect(page.getByText(`加入「${founder.householdName}」`)).toBeVisible();
  await page.getByLabel('显示名称').fill('小红');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('invitee-password');
  await page.getByRole('button', { name: '注册并加入' }).click();

  await expect(page.getByText(founder.householdName)).toBeVisible();
  await expect(page.getByText('小红')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '商品' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '邀请' })).toHaveCount(0);

  await page.goto(link);
  await expect(page.getByRole('alert')).toContainText('一个成员只能属于一个家庭');
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('alert')).toContainText('已经被使用过了');
});

test('a revoked link can no longer be used', async ({ page }) => {
  await signInAsFounder(page);
  const link = await generateLink(page);
  await linkItem(page, link).getByRole('button', { name: '作废' }).click();
  await expect(linkItem(page, link)).toHaveCount(0);
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();

  await page.goto(link);
  await expect(page.getByRole('alert')).toContainText('已被作废');
});
