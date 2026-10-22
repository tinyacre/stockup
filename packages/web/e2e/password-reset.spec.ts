import { latestCode } from './mail';
import { expect, test } from './test';

test('a member resets a forgotten password with an emailed code', async ({ page, playwright, baseURL }) => {
  const id = crypto.randomUUID().slice(0, 8);
  const member = { email: `reset_${id}@example.com`, username: `reset_${id}`, password: `password-${id}`, name: '小忘' };

  // Registering in a context of its own leaves that context signed in, standing in for another device.
  const otherDevice = await playwright.request.newContext({ baseURL });
  await otherDevice.post('/api/email-codes', { data: { email: member.email, purpose: 'register' } });
  const signedUp = await otherDevice.post('/api/signup', {
    data: { ...member, code: await latestCode(otherDevice, member.email) },
  });
  expect(signedUp.status()).toBe(201);

  await page.goto('/');
  await page.getByRole('link', { name: '忘记密码？' }).click();
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel('邮箱').fill(member.email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByRole('status')).toContainText('验证码已发送');

  // The signup code is the newest mail until the reset code arrives.
  await expect
    .poll(async () => {
      const res = await page.request.get(`/__e2e/mail?to=${encodeURIComponent(member.email)}`);
      return ((await res.json()) as { messages: { text: string }[] }).messages[0]?.text;
    })
    .toContain('找回密码验证码');
  await page.getByLabel('验证码').fill(await latestCode(page.request, member.email));
  const newPassword = `new-password-${id}`;
  await page.getByLabel('新密码').fill(newPassword);
  await page.getByRole('button', { name: '重置密码' }).click();
  await expect(page.getByRole('alert')).toHaveText('密码已重置，其他设备上的登录已失效');

  expect((await otherDevice.get('/api/me')).status()).toBe(401);
  await otherDevice.dispose();

  await page.getByRole('link', { name: '用新密码登录' }).click();
  await page.getByLabel('用户名或邮箱').fill(member.email);
  await page.getByLabel('密码').fill(member.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('alert')).toHaveText('用户名或密码错误');
  await page.getByLabel('密码').fill(newPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText(`${member.username} 的家`)).toBeVisible();
});
