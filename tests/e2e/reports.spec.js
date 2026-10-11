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

  const hearingStart = todayIso(-30);
  const hearingEnd = todayIso(30);
  const displayDate = value => value.split("-").reverse().join(".");
  await page.locator("#hearingReportStart").fill(hearingStart);
  await page.locator("#hearingReportEnd").fill(hearingEnd);
  const hearingPdf = page.waitForEvent("download");
  await page.locator("#printHearingReport").click();
  const expectedBrowserFilename = `${displayDate(hearingStart)} - ${displayDate(hearingEnd)} Duruşma Listesi.pdf`;
  expect((await hearingPdf).suggestedFilename()).toBe(expectedBrowserFilename);

  const deadlineStart = todayIso(-30);
  const deadlineEnd = todayIso(30);
  await page.locator("#deadlineReportStart").fill(deadlineStart);
  await page.locator("#deadlineReportEnd").fill(deadlineEnd);
  const deadlineCsv = page.waitForEvent("download");
  await page.locator("#exportDeadlines").click();
  const expectedDeadlineFilename = `${displayDate(deadlineStart)} - ${displayDate(deadlineEnd)} Süreli İş Raporu.csv`;
  expect((await deadlineCsv).suggestedFilename()).toBe(expectedDeadlineFilename);

  diagnostics.assertClean();
});
