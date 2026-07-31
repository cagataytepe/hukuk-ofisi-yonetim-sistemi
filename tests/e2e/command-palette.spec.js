import { expect, test } from "@playwright/test";
import { attachDiagnostics, login } from "./support/app.js";

test("Ctrl+K komut paleti klavye ve yetki davranışını korur", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);
  await page.keyboard.press("Control+K");
  await expect(page.locator("#commandPalette")).toBeVisible();
  await expect(page.locator("#commandPaletteResults")).toContainText("Ana Sayfaya Git");
  await page.locator("#commandPaletteInput").fill("görev");
  await expect(page.locator("#commandPaletteResults")).toContainText("Görevlere Git");
  await page.keyboard.press("Enter");
  await expect(page.locator("section#tasks")).toHaveClass(/active/);
  await page.keyboard.press("Control+K");
  await page.keyboard.press("Escape");
  await expect(page.locator("#commandPalette")).not.toBeVisible();
  diagnostics.assertClean();
});
