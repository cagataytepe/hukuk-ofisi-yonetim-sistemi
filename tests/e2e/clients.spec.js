import { expect, test } from "@playwright/test";
import { attachDiagnostics, createLawsuitFile, deleteFileByPrefix, gotoSection, login } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Müvekkiller ekranı public.clients/file_parties kaynaklı müvekkil kartını açar", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("CLIENT");
  await login(page);

  try {
    await createLawsuitFile(page, prefix);
    await gotoSection(page, "clients");
    await page.locator("#clientSearch").fill(prefix);
    const row = page.locator("#clientRows tr").filter({ hasText: prefix }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator("[data-client-name]").click();
    await expect(page.locator("#clientDetailPanel")).toBeVisible();
    await expect(page.locator("#clientDetailTitle")).toContainText(prefix);
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
