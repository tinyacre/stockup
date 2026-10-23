import type { Browser, Page } from '@playwright/test';
import { expect, test } from './test';
import { founder } from './founder';
import { latestCode } from './mail';

function suffix() {
  return crypto.randomUUID().slice(0, 6);
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
}

function openSection(page: Page, label: string) {
  return page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label }).click();
}

async function newHousehold(page: Page) {
  const id = suffix();
  const admin = { name: `管理员${id}`, username: `admin_${id}`, password: `password-${id}` };
  const householdName = `第二个家${id}`;

  await signIn(page, founder.username, founder.password);
  await openSection(page, '家庭');
  await page.getByRole('button', { name: '新建家庭' }).click();
  const form = page.getByRole('form', { name: '新建家庭' });
  await form.getByLabel('家庭名称').fill(householdName);
  await form.getByLabel('管理员显示名称').fill(admin.name);
  await form.getByLabel('管理员用户名').fill(admin.username);
  await form.getByLabel('管理员初始密码').fill(admin.password);
  await form.getByRole('button', { name: '新建家庭' }).click();
  await expect(page.getByRole('list', { name: '所有家庭' })).toContainText(householdName);
  await signOut(page);

  return { householdName, admin };
}

async function generateLink(page: Page) {
  await openSection(page, '邀请');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/invitations') && r.request().method() === 'POST'),
    page.getByRole('button', { name: '生成邀请链接' }).click(),
  ]);
  const { id } = (await response.json()) as { id: string };
  return `/join/${id}`;
}

async function invite(page: Page, browser: Browser) {
  const link = await generateLink(page);

  const id2 = suffix();
  const account = { name: `家人${id2}`, username: `family_${id2}`, password: `password-${id2}` };
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(link);
  const email = `${account.username}@example.com`;
  await other.getByLabel('邮箱').fill(email);
  await other.getByRole('button', { name: '发送验证码' }).click();
  await other.getByLabel('验证码').fill(await latestCode(other.request, email));
  await other.getByLabel('显示名称').fill(account.name);
  await other.getByLabel('用户名').fill(account.username);
  await other.getByLabel('密码').fill(account.password);
  await other.getByRole('button', { name: '注册并加入' }).click();
  await expect(other.getByRole('navigation', { name: '主导航' })).toBeVisible();
  return { ...account, page: other };
}

test('the instance admin creates a household that starts with the preset promotions', async ({ page }) => {
  const { householdName, admin } = await newHousehold(page);
  await signIn(page, admin.username, admin.password);
  await expect(page.getByText(householdName)).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '家庭' })).toHaveCount(0);
  await openSection(page, '大促');
  await expect(page.getByText('双 11').first()).toBeVisible();
});

test('a removed member is signed out at once and rejoins later with the same account', async ({
  page,
  browser,
  household,
}) => {
  const { admin } = household;
  await signIn(page, admin.username, admin.password);
  const member = await invite(page, browser);

  await openSection(page, '成员');
  const list = page.getByRole('list', { name: '家庭成员' });
  await expect(list).toContainText(member.name);
  await page.getByRole('button', { name: `移除 ${member.name}` }).click();
  await page.getByRole('button', { name: `确认移除 ${member.name}` }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(list).not.toContainText(member.name);

  await member.page.reload();
  await expect(member.page.getByRole('button', { name: '登录' })).toBeVisible();
  await member.page.getByLabel('用户名').fill(member.username);
  await member.page.getByLabel('密码').fill(member.password);
  await member.page.getByRole('button', { name: '登录' }).click();
  await expect(member.page.getByRole('alert')).toContainText('当前账号不属于任何家庭');

  const link = await generateLink(page);
  await member.page.goto(link);
  await member.page.getByRole('button', { name: '用当前账号加入' }).click();
  await expect(member.page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await openSection(page, '成员');
  await expect(list).toContainText(member.name);
});

test('a signed-out invitee with an account signs in and joins with it', async ({ page, browser, household }) => {
  const { admin } = household;
  await signIn(page, admin.username, admin.password);
  const member = await invite(page, browser);
  await openSection(page, '成员');
  await page.getByRole('button', { name: `移除 ${member.name}` }).click();
  await page.getByRole('button', { name: `确认移除 ${member.name}` }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByRole('list', { name: '家庭成员' })).not.toContainText(member.name);

  const link = await generateLink(page);
  await member.page.goto(link);
  await member.page.getByRole('button', { name: '已有账号？登录后用它加入' }).click();
  await member.page.getByLabel('用户名').fill(member.username);
  await member.page.getByLabel('密码').fill(member.password);
  await member.page.getByRole('button', { name: '登录' }).click();
  await member.page.getByRole('button', { name: '用当前账号加入' }).click();
  await expect(member.page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(member.page).toHaveURL(/\/$/);
});

test('a household admin renames the household', async ({ page, household }) => {
  await signIn(page, household.admin.username, household.admin.password);
  await openSection(page, '成员');
  const renamed = `新家${suffix()}`;
  const panel = page.getByRole('region', { name: '家庭名称' });
  await panel.getByLabel('家庭名称').fill(renamed);
  await panel.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('banner')).toContainText(renamed);
  await page.reload();
  await expect(page.getByRole('banner')).toContainText(renamed);
});

test('a household admin hands the admin role to another member', async ({ page, browser, household }) => {
  const { admin } = household;
  await signIn(page, admin.username, admin.password);
  const member = await invite(page, browser);

  await openSection(page, '成员');
  await page.getByRole('button', { name: `把管理员转交给 ${member.name}` }).click();
  await page.getByRole('button', { name: `确认把管理员转交给 ${member.name}` }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '成员' })).toHaveCount(0);

  await member.page.reload();
  await openSection(member.page, '成员');
  await expect(member.page.getByRole('list', { name: '家庭成员' }).getByRole('listitem').first()).toContainText(
    `${member.name}管理员`,
  );
});

test('a member renames themselves, changes the password and signs out other devices', async ({
  page,
  browser,
  household,
}) => {
  const { admin } = household;
  await signIn(page, admin.username, admin.password);
  const other = await (await browser.newContext()).newPage();
  await signIn(other, admin.username, admin.password);

  await openSection(page, '设置');
  const renamed = `新名字${suffix()}`;
  const name = page.getByRole('region', { name: '显示名称' });
  await name.getByLabel('显示名称').fill(renamed);
  await name.getByRole('button', { name: '保存名称' }).click();
  await expect(page.getByRole('banner')).toContainText(renamed);

  const password = page.getByRole('region', { name: '密码' });
  await password.getByLabel('当前密码').fill('wrong-password');
  await password.getByLabel('新密码').fill('a-brand-new-password');
  await password.getByRole('button', { name: '修改密码' }).click();
  await expect(password.getByRole('alert')).toHaveText('当前密码错误');
  await password.getByLabel('当前密码').fill(admin.password);
  await password.getByRole('button', { name: '修改密码' }).click();
  await expect(page.getByText('密码已修改')).toBeVisible();

  await page.getByRole('button', { name: '登出其他设备' }).click();
  await expect(page.getByText('其他设备已登出')).toBeVisible();
  await other.reload();
  await expect(other.getByRole('button', { name: '登录' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('banner')).toContainText(renamed);
  await signOut(page);
  await signIn(page, admin.username, 'a-brand-new-password');
});
