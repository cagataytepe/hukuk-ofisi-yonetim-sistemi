import { expect, test } from "@playwright/test";
import { e2eCredentials } from "./support/env.js";

test("cold start is clean, remembered session restores, explicit logout clears it", async ({ page, context }) => {
  test.setTimeout(120_000);
  const { email, password } = e2eCredentials();

  await page.goto("/mobile.html");
  await expect(page.locator("#mobileLoginForm")).toBeVisible();
  await expect(page.locator("#mobileLoginError")).toBeEmpty();
  await expect(page.locator("#mobileRememberLogin")).toBeChecked();

  await page.locator("#mobileEmail").fill(email);
  await page.locator("#mobilePassword").fill(password);
  await page.locator("#mobileLoginButton").click();
  await expect(page.locator(".mobile-shell")).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.locator(".mobile-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#mobileLoginForm")).toHaveCount(0);

  const reopened = await context.newPage();
  await reopened.goto("/mobile.html");
  await expect(reopened.locator(".mobile-shell")).toBeVisible({ timeout: 30_000 });
  await reopened.close();

  await page.locator(".topbar-profile-button").click();
  await page.locator('[data-action="logout"]').click();
  await expect(page.locator("#mobileLoginForm")).toBeVisible();
  await page.reload();
  await expect(page.locator("#mobileLoginForm")).toBeVisible();
  await expect(page.locator("#mobileLoginError")).toBeEmpty();
});
