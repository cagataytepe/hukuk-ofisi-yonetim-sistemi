import { expect, test } from "@playwright/test";
import { attachDiagnostics, createLawsuitFile, deleteFileByPrefix, fillDatalistByPrefix, gotoSection, login, selectFirstOption, todayIso } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Duruşmalar ekranı public.hearings üzerinde oluşturma ve soft delete yapar", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("HEARING");
  await login(page);

  try {
    await createLawsuitFile(page, prefix);
    await gotoSection(page, "hearings");
    await fillDatalistByPrefix(page, "#hearingCase", "#hearingCaseList", prefix);
    await page.locator('#hearingForm input[type="date"]').fill(todayIso());
    await page.locator('#hearingForm input[type="time"]').fill("09:45");
    await selectFirstOption(page, "#hearingPerson");
    await page.locator("#hearingForm textarea").fill(`${prefix} duruşma notu`);
    await page.locator("#hearingSubmit").click();

    const chip = page.locator("#hearingsPrintPanel #hearingCalendar .hearing-chip").filter({ hasText: prefix }).first();
    await expect(chip).toBeVisible({ timeout: 30_000 });
    page.once("dialog", dialog => dialog.accept().catch(() => {}));
    await chip.locator("[data-delete-hearing]").click();
    await expect(page.locator("#hearingsPrintPanel #hearingCalendar")).not.toContainText(`${prefix} duruşma notu`, { timeout: 20_000 });
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
