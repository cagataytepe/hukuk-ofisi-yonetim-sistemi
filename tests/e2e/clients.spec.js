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

    const identity = await page.evaluate(async () => {
      const repository = window.BKTHukukRepository?.createBrowserRepository();
      if (!repository) return "";
      await repository.ready;
      const clients = await repository.getRepresentedClients();
      const client = clients.find(item => /^\d{11}$/.test(String(item.national_id || "").trim()));
      return String(client?.national_id || "").trim();
    });
    if (!identity) throw new Error("Maskesiz TCKN testi için uygun aktif müvekkil bulunamadı.");
    await page.locator("#closeClientDetail").click();
    await page.locator("#clientSearch").fill(identity);
    const identityRow = page.locator("#clientRows tr").first();
    await expect(identityRow).toBeVisible({ timeout: 20_000 });
    expect(await identityRow.evaluate((element, expected) => element.textContent.includes(expected) && !/[•*]/.test(element.textContent), identity)).toBe(true);
    await identityRow.locator("[data-client-name]").click();
    expect(await page.locator("#clientDetailContent").evaluate((element, expected) => element.textContent.includes(expected) && !/[•*]/.test(element.textContent), identity)).toBe(true);
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
