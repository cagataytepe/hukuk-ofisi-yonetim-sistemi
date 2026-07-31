import { expect, test } from "@playwright/test";
import { attachDiagnostics, login } from "./support/app.js";

test("evrensel arama debounce ve gruplu sonuç davranışını uygular", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);
  await page.locator(".global-search input").click();
  await expect(page.locator("#commandPalette")).toBeVisible();
  await page.locator("#commandPaletteInput").fill("a");
  await expect(page.locator("#commandPaletteResults")).not.toContainText("Kayıtlar aranıyor");
  await page.locator("#commandPaletteInput").fill("2026");
  await expect(page.locator("#commandPaletteResults")).not.toContainText("Kayıtlar aranıyor", { timeout: 15_000 });
  await expect(page.locator("#commandPaletteResults [data-command-index]").first()).toBeVisible();
  await page.keyboard.press("Escape");
  diagnostics.assertClean();
});
