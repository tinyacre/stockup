import { expect, test, type Browser, type Page } from '@playwright/test';
import { founder } from './founder';

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

// Each run gets its own household from the instance admin, so desktop and phone runs cannot disturb each other.
async function newHousehold(page: Page) {
  const id = suffix();
  const admin = { name: `管理员${id}`, username: `admin_${id}`, password: `password-${id}` };
  const householdName = `第二个家${id}`;

  await signIn(page, founder.username, founder.password);
  await openSection(page, '家庭');
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

async function invite(page: Page, browser: Browser) {
  await openSection(page, '邀请');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/invitations') && r.request().method() === 'POST'),
    page.getByRole('button', { name: '生成邀请链接' }).click(),
  ]);
  const { id } = (await response.json()) as { id: string };

  const id2 = suffix();
  const account = { name: `家人${id2}`, username: `family_${id2}`, password: `password-${id2}` };
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(`/join/${id}`);
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

test('a household admin removes a member, who is signed out at once', async ({ page, browser }) => {
  const { admin } = await newHousehold(page);
  await signIn(page, admin.username, admin.password);
  const member = await invite(page, browser);

  await openSection(page, '成员');
  const list = page.getByRole('list', { name: '家庭成员' });
  await expect(list).toContainText(member.name);
  await page.getByRole('button', { name: `移除 ${member.name}` }).click();
  await page.getByRole('button', { name: `确认移除 ${member.name}` }).click();
  await expect(list).not.toContainText(member.name);

  await member.page.reload();
  await expect(member.page.getByRole('button', { name: '登录' })).toBeVisible();
});

test('a household admin hands the admin role to another member', async ({ page, browser }) => {
  const { admin } = await newHousehold(page);
  await signIn(page, admin.username, admin.password);
  const member = await invite(page, browser);

  await openSection(page, '成员');
  await page.getByRole('button', { name: `把管理员转交给 ${member.name}` }).click();
  await page.getByRole('button', { name: `确认把管理员转交给 ${member.name}` }).click();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '成员' })).toHaveCount(0);

  await member.page.reload();
  await openSection(member.page, '成员');
  await expect(member.page.getByRole('list', { name: '家庭成员' }).getByRole('listitem').first()).toContainText(
    `${member.name}管理员`,
  );
});

test('a member renames themselves, changes the password and signs out other devices', async ({ page, browser }) => {
  const { admin } = await newHousehold(page);
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
  await expect(password.getByRole('alert')).toHaveText('当前密码不正确。');
  await password.getByLabel('当前密码').fill(admin.password);
  await password.getByRole('button', { name: '修改密码' }).click();
  await expect(password.getByRole('status')).toContainText('密码已修改');

  await page.getByRole('button', { name: '登出其他设备' }).click();
  await expect(page.getByRole('status').last()).toHaveText('其他设备已登出。');
  await other.reload();
  await expect(other.getByRole('button', { name: '登录' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('banner')).toContainText(renamed);
  await signOut(page);
  await signIn(page, admin.username, 'a-brand-new-password');
});
