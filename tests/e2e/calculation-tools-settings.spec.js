import { expect, test } from "@playwright/test";
import { attachDiagnostics, gotoSection, login } from "./support/app.js";

test("Merkezi Hesaplama Araçları Ayarlar altında gerçek tarifeleri gösterir", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);
  await gotoSection(page, "users");

  await expect(page.locator("#openCalculationTools")).toBeVisible();
  await page.locator("#openCalculationTools").click();
  await expect(page.locator("#calculationToolsDialog")).toBeVisible();

  await expect(page.locator("#interestRateSettingsRows")).toContainText("Adi Kanuni Faiz", { timeout: 30_000 });
  await expect(page.locator("#interestRateSettingsRows tr")).not.toHaveCount(0);
  await expect(page.locator("#interestRateSettingsRows")).toContainText("Tarihçe");

  await page.locator('[data-calculation-tab="attorney"]').click();
  await expect(page.locator("#attorneyFeeSettingsRows")).toContainText("AAÜT", { timeout: 30_000 });

  await page.locator('[data-calculation-tab="parameters"]').click();
  await expect(page.locator("#calculationParameterRows")).toContainText("Faiz Gün Bazı", { timeout: 30_000 });
  await expect(page.locator("#calculationParameterRows")).toContainText("Çek Tazminatı Oranı");

  await page.locator("#closeCalculationTools").click();
  await gotoSection(page, "cases");
  await page.locator("#openNewFileForm").click();
  await page.locator('[data-file-type-card="İcra Dosyası"]').click();
  await expect(page.locator("#caseForm #openCalculationTools")).toHaveCount(0);
  await expect(page.locator("#caseInterestType")).toBeVisible();

  diagnostics.assertClean();
});
