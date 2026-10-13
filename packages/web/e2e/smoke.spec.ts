import { expect, test } from '@playwright/test';

test('opens the home page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'StockUp' })).toBeVisible();
});
