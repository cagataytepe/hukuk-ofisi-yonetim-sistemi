import { expect, test } from "@playwright/test";
import { attachDiagnostics, createLawsuitFile, deleteFileByPrefix, expectNoVisibleUuid, gotoSection, login } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Dosya oluşturma, arama, detay açma, yenileme ve soft delete", async ({ page }) => {
  const diagnostics = attachDiagnostics(page, { ignoreFetchAbortNoise: true });
  const prefix = e2ePrefix("FILE");
  await login(page);

  try {
    await createLawsuitFile(page, prefix);
    await page.fill("#fileListSearch", prefix);
    await expect(page.locator("#caseRows")).toContainText(prefix);
    await page.fill("#fileListSearch", `${prefix} Karşı Taraf`);
    await expect(page.locator("#caseRows")).toContainText(prefix, { timeout: 20_000 });
    await page.locator("#caseRows [data-view-file]").first().click();
    await expect(page.locator("#fileDetailPanel")).toBeVisible();
    await expect(page.locator("#fileDetailPanel")).toContainText(prefix);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await gotoSection(page, "cases");
    await page.fill("#fileListSearch", prefix);
    await expect(page.locator("#caseRows")).toContainText(prefix);
    await expectNoVisibleUuid(page);

    await page.goto("/mobile.html");
    await expect(page.locator(".mobile-shell")).toBeVisible({ timeout: 30_000 });
    await page.locator('.mobile-nav[data-route="files"]').click();
    await page.locator("#mobileFileSearch").fill(`${prefix} Karşı Taraf`);
    await expect(page.locator("[data-file-id]").filter({ hasText: prefix }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    if (page.url().includes("mobile.html") && !page.isClosed()) {
      await page.goto("/");
      await expect(page.locator("body")).toHaveClass(/is-authenticated/, { timeout: 30_000 });
    }
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});

test("Büromuzca temsil edilen davalı dosya listesinde müvekkil olarak gösterilir", async ({ page }) => {
  const diagnostics = attachDiagnostics(page, { ignoreFetchAbortNoise: true });
  const prefix = e2ePrefix("REPRESENTED-DEFENDANT");
  await login(page);

  try {
    await createLawsuitFile(page, prefix, { representedSide: "opponent", status: "Karara Çıkmış" });
    await page.fill("#fileListSearch", prefix);
    const row = page.locator("#caseRows tr").filter({ hasText: prefix }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('td[data-label="Müvekkil"]')).toContainText(`${prefix} Karşı Taraf`);
    await expect(row.locator('td[data-label="Karşı Taraf"]')).toContainText(`${prefix} Müvekkil`);
    const statusCell = row.locator('td[data-label="Durum"]');
    await expect(statusCell).toHaveText("Karara Çıkmış");
    await expect.poll(async () => statusCell.evaluate(cell => cell.scrollWidth <= cell.clientWidth)).toBe(true);

    await page.reload();
    await gotoSection(page, "cases");
    await page.fill("#fileListSearch", prefix);
    const reloadedRow = page.locator("#caseRows tr").filter({ hasText: prefix }).first();
    await expect(reloadedRow.locator('td[data-label="Müvekkil"]')).toContainText(`${prefix} Karşı Taraf`, { timeout: 30_000 });
    await expect(reloadedRow.locator('td[data-label="Karşı Taraf"]')).toContainText(`${prefix} Müvekkil`);
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
