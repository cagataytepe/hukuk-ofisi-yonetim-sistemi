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
    await page.locator("#caseRows [data-view-file]").first().click();
    await expect(page.locator("#fileDetailPanel")).toBeVisible();
    await expect(page.locator("#fileDetailPanel")).toContainText(prefix);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await gotoSection(page, "cases");
    await page.fill("#fileListSearch", prefix);
    await expect(page.locator("#caseRows")).toContainText(prefix);
    await expectNoVisibleUuid(page);
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
