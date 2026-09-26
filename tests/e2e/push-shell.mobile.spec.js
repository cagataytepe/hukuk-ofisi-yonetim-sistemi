import { expect, test } from '@playwright/test';

test('push bridge does not disturb the unauthenticated mobile shell in browser', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/mobile.html');
  await expect(page.locator('#mobileLoginForm')).toBeVisible();
  await expect(page.locator('#mobileEmail')).toBeVisible();
  await expect(page.locator('#mobileLoginError')).toBeEmpty();
  expect(errors).toEqual([]);
});
