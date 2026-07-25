import { expect, test } from '@playwright/test';

test('home renders the CommandOS surface', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Command your entire');
  await expect(page.getByRole('button', { name: /Enter CommandOS/i })).toBeVisible();
});
