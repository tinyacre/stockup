import { test as base } from '@playwright/test';
import type { Me } from '../src/lib/api';
import type { Theme } from '../src/lib/theme';

export { expect } from '@playwright/test';

export interface ThemeOptions {
  // Renders every page in this theme whatever the account chose, so one run covers one theme.
  theme: Theme | null;
}

export const test = base.extend<ThemeOptions>({
  theme: [null, { option: true }],
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
