import { expect, test } from "@playwright/test";
import { attachDiagnostics, gotoSection, login } from "./support/app.js";

test("Mobil görünümde giriş, menü ve ana modüller taşmadan açılır", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobil proje için ayrılmıştır.");
  const diagnostics = attachDiagnostics(page);
  await login(page);

  await expect(page.locator(".mobile-bar")).toBeVisible();
  await page.locator("#menuToggle").click();
  await expect(page.locator("#sidebar")).toHaveClass(/open/);
  await gotoSection(page, "cases");
  await expect(page.locator("#caseRows")).toBeVisible();
  await page.locator("#menuToggle").click();
  await gotoSection(page, "tasks");
  await expect(page.locator("#taskRows")).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(horizontalOverflow).toBe(false);
  diagnostics.assertClean();
});
