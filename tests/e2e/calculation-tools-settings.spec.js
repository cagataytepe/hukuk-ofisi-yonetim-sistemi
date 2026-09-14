import { expect, test } from "@playwright/test";
import { attachDiagnostics, gotoSection, login } from "./support/app.js";

test("Merkezi Hesaplama Araçları Ayarlar altında gerçek tarifeleri gösterir", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);
  await gotoSection(page, "users");

  await expect(page.locator("#settingsUsersView")).toBeVisible();
  await expect(page.locator("#calculationSettingsView")).toBeHidden();
  await expect(page.locator("#openCalculationTools")).toBeVisible();
  await page.locator("#openCalculationTools").click();
  await expect(page.locator("#settingsUsersView")).toBeHidden();
  await expect(page.locator("#calculationSettingsView")).toBeVisible();
  await expect(page.locator("#calculationToolsDialog")).toBeVisible();

  await expect(page.locator("#interestRateSettingsRows")).toContainText("Adi Kanuni Faiz", { timeout: 30_000 });
  await expect(page.locator("#interestRateSettingsRows tr")).not.toHaveCount(0);
  await expect(page.locator("#interestRateSettingsRows")).toContainText("Düzenle");

  const currentLegalInterestRow = page.locator("#interestRateSettingsRows tr")
    .filter({ hasText: "Adi Kanuni Faiz" })
    .filter({ hasText: "Devam Ediyor" })
    .first();
  await expect(currentLegalInterestRow.locator("[data-edit-interest-rate]")).toBeVisible();
  await currentLegalInterestRow.locator("[data-edit-interest-rate]").click();
  await expect(page.locator("#interestRateFormTitle")).toHaveText("Faiz Dönemini Düzenle");
  await expect(page.locator("#settingInterestToField")).toBeVisible();
  await expect(page.locator("#settingInterestType")).toBeDisabled();
  await expect(page.locator("#settingInterestFrom")).toHaveAttribute("readonly", "");
  await expect(page.locator("#settingInterestRate")).toHaveAttribute("readonly", "");
  await page.locator("#newInterestRateSetting").click();
  await expect(page.locator("#interestRateFormTitle")).toHaveText("Yeni Faiz Dönemi");
  await expect(page.locator("#settingInterestToField")).toBeHidden();

  await page.locator('[data-calculation-tab="attorney"]').click();
  await expect(page.locator("#attorneyFeeSettingsRows")).toContainText("AAÜT", { timeout: 30_000 });

  await page.locator('[data-calculation-tab="parameters"]').click();
  await expect(page.locator("#calculationParameterRows")).toContainText("Faiz Gün Bazı", { timeout: 30_000 });
  await expect(page.locator("#calculationParameterRows")).toContainText("Çek Tazminatı Oranı");

  await page.locator("#settingsUsersShortcut").click();
  await expect(page.locator("#settingsUsersView")).toBeVisible();
  await expect(page.locator("#calculationSettingsView")).toBeHidden();
  await gotoSection(page, "cases");
  await page.locator("#openNewFileForm").click();
  await page.locator('[data-file-type-card="İcra Dosyası"]').click();
  await expect(page.locator("#caseForm #openCalculationTools")).toHaveCount(0);

  await page.locator("#caseEnforcementOffice").fill("E2E Hesaplama İcra Dairesi");
  await page.locator("#caseTrackingNo").fill("E2E/032");
  await page.locator("#caseFollowUpDate").fill("2026-08-04");
  await page.locator("#caseStepNext").click();

  await page.locator('#enforcementCreditorRows .enforcement-party-name').fill("E2E Alacaklı");
  await page.locator('#enforcementCreditorRows .party-represented').check();
  await page.locator('#enforcementDebtorRows .enforcement-party-name').fill("E2E Borçlu");
  await page.locator("#caseStepNext").click();

  await expect(page.locator("#caseInterestType")).toBeVisible();

  diagnostics.assertClean();
});
