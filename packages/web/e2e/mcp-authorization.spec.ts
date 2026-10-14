import { expect, test, type Page } from '@playwright/test';
import { founder } from './founder';

const claudeClientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const claudeCallback = 'https://claude.ai/api/mcp/auth_callback';

// Starts an authorization request the way Claude does after discovering StockUp's MCP endpoint, asking for
// consent again even though desktop and phone runs share the founder, who may have consented already.
async function startAuthorization(page: Page) {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: claudeClientId,
    redirect_uri: claudeCallback,
    code_challenge: Buffer.from(digest).toString('base64url'),
    code_challenge_method: 'S256',
    state,
    scope: 'stockup:read offline_access',
    prompt: 'consent',
    resource: new URL('/mcp', test.info().project.use.baseURL).toString(),
  });
  // Claude's callback is outside the test, so the redirect back to it is answered here.
  const callback = new Promise<URL>((resolve) =>
    page.route(`${claudeCallback}**`, (route) => {
      resolve(new URL(route.request().url()));
      return route.fulfill({ body: 'Claude' });
    }),
  );
  await page.goto(`/api/auth/oauth2/authorize?${params}`);
  return { state, callback };
}

test('a member signs in and authorizes Claude', async ({ page }) => {
  const { state, callback } = await startAuthorization(page);
  await expect(page).toHaveURL(/\/oauth\/sign-in\?/);
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(/\/oauth\/consent\?/);
  await expect(page.getByText('授权 claude.ai 访问 StockUp')).toBeVisible();
  await expect(page.getByText('这个应用自称「Claude」')).toBeVisible();
  await expect(page.getByText(`以「${founder.name}」的身份访问「${founder.householdName}」的数据`)).toBeVisible();
  await expect(page.getByText('查看家庭的商品和价格')).toBeVisible();
  await page.getByRole('button', { name: '允许' }).click();

  const returned = await callback;
  expect(returned.searchParams.get('state')).toBe(state);
  expect(returned.searchParams.get('code')).toBeTruthy();
});

test('a member who declines sends Claude an access_denied error', async ({ page }) => {
  const { callback } = await startAuthorization(page);
  await page.getByLabel('用户名').fill(founder.username);
  await page.getByLabel('密码').fill(founder.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '拒绝' }).click();

  const returned = await callback;
  expect(returned.searchParams.get('error')).toBe('access_denied');
  expect(returned.searchParams.get('code')).toBeNull();
});
