import { test as base } from '@playwright/test';
import type { Me } from '../src/lib/api';
import type { Theme } from '../src/lib/theme';
import { founder } from './founder';

export { expect } from '@playwright/test';

export interface ThemeOptions {
  // Renders every page in this theme whatever the account chose, so one run covers one theme.
  theme: Theme | null;
}

export interface Household {
  name: string;
  admin: { name: string; username: string; password: string };
}

export const test = base.extend<ThemeOptions & { household: Household }>({
  theme: [null, { option: true }],
  // Every test works in a household of its own, made by the instance admin, so tests running in parallel
  // across projects and workers never see each other's data.
  household: async ({ playwright, baseURL }, use) => {
    const id = crypto.randomUUID().slice(0, 8);
    const household = {
      name: `测试之家 ${id}`,
      admin: { name: '小明', username: `admin_${id}`, password: `password-${id}` },
    };
    const request = await playwright.request.newContext({ baseURL });
    const signedIn = await request.post('/api/auth/sign-in/username', {
      data: { username: founder.username, password: founder.password },
    });
    if (!signedIn.ok()) throw new Error(`founder sign-in failed: ${signedIn.status()}`);
    const created = await request.post('/api/households', {
      data: { householdName: household.name, admin: household.admin },
    });
    if (created.status() !== 201) throw new Error(`household creation failed: ${created.status()}`);
    await request.dispose();
    await use(household);
  },
  context: async ({ context, theme }, use) => {
    if (theme) {
      // Requests a service worker answers bypass this route, so projects that set a theme block service workers.
      await context.route('**/api/me', async (route) => {
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const me = (await response.json()) as Me;
        await route.fulfill({ response, json: { ...me, user: { ...me.user, theme } } });
      });
    }
    await use(context);
  },
});
