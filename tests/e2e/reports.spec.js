import { expect, test } from "@playwright/test";
import { attachDiagnostics, gotoSection, login, todayIso } from "./support/app.js";

test("Raporlar ekranı Supabase tablolarından özet üretir ve çıktı dosyaları indirir", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);

  await gotoSection(page, "reports");
  await expect(page.locator("#officeReportSummary")).toContainText(/Toplam|Durum/i, { timeout: 30_000 });
  await page.selectOption("#officeReportType", { index: 1 });
  await expect(page.locator("#officeReportHead")).toContainText(/Sorumlu|Durum/i);

  const officeDownload = page.waitForEvent("download");
  await page.locator("#exportOfficeReport").click();
  await expect((await officeDownload).suggestedFilename()).toMatch(/\.csv$/i);

  await page.locator("#hearingReportStart").fill(todayIso(-30));
  await page.locator("#hearingReportEnd").fill(todayIso(30));
  const hearingPdf = page.waitForEvent("download");
  await page.locator("#printHearingReport").click();
  await expect((await hearingPdf).suggestedFilename()).toMatch(/durusma.*\.pdf$/i);

  await page.locator("#deadlineReportStart").fill(todayIso(-30));
  await page.locator("#deadlineReportEnd").fill(todayIso(30));
  const deadlineCsv = page.waitForEvent("download");
  await page.locator("#exportDeadlines").click();
  await expect((await deadlineCsv).suggestedFilename()).toMatch(/sureli.*\.csv$/i);

  diagnostics.assertClean();
});
