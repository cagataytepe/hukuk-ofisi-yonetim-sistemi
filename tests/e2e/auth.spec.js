import { expect, test } from "@playwright/test";
import { attachDiagnostics, login, logout } from "./support/app.js";
import { e2eCredentials } from "./support/env.js";

test("Supabase Auth giriş, oturum yenileme ve çıkış akışı", async ({ page }) => {
  const loginDiagnostics = attachDiagnostics(page, { ignoreExpectedAuthFailures: true, ignoreFetchAbortNoise: true });
  const { email, password } = e2eCredentials();

  await page.goto("/");
  await expect(page.locator("#loginEmail")).toBeVisible();
  await page.fill("#loginEmail", email);
  await page.fill("#loginPassword", "not-the-real-password");
  await page.locator("#loginForm button[type='submit']").click();
  await expect(page.locator("#loginError")).toContainText(/hatalı|hata/i);

  await page.fill("#loginPassword", password);
  await page.locator("#loginForm button[type='submit']").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/, { timeout: 30_000 });
  await expect(page.locator("#sessionDisplayName")).not.toBeEmpty();
  await expect(page.locator("#sessionRole")).not.toBeEmpty();

  await page.reload();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/, { timeout: 30_000 });

  await logout(page);
  loginDiagnostics.events.length = 0;
  const diagnostics = attachDiagnostics(page, { ignoreFetchAbortNoise: true });
  await login(page);
  diagnostics.assertClean();
});
