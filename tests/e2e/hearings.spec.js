import { expect, test } from "@playwright/test";
import { attachDiagnostics, createLawsuitFile, currentWorkweekDateIso, deleteFileByPrefix, fillDatalistByPrefix, gotoSection, login, selectFirstOption } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Duruşmalar ekranı public.hearings üzerinde oluşturma ve soft delete yapar", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("HEARING");
  await login(page);

  try {
    await createLawsuitFile(page, prefix);
    await gotoSection(page, "hearings");
    await fillDatalistByPrefix(page, "#hearingCase", "#hearingCaseList", prefix);
    await page.locator('#hearingForm input[type="date"]').fill(currentWorkweekDateIso());
    await page.locator('#hearingForm input[type="time"]').fill("09:45");
    await selectFirstOption(page, "#hearingPerson");
    await page.locator("#hearingForm textarea").fill(`${prefix} duruşma notu`);
    await page.locator("#hearingSubmit").click();

    const chip = page.locator("#hearingsPrintPanel #hearingCalendar .hearing-chip").filter({ hasText: prefix }).first();
    await expect(chip).toBeVisible({ timeout: 30_000 });

    await page.goto("/mobile.html");
    await expect(page.locator(".mobile-shell")).toBeVisible({ timeout: 30_000 });
    await page.locator('.mobile-nav[data-route="hearings"]').click();
    const mobileHearing = page.locator(".hearing-card[data-file-id]").filter({ hasText: prefix }).first();
    await expect(mobileHearing).toBeVisible({ timeout: 30_000 });
    await mobileHearing.click();
    await expect(page.locator(".file-hero")).toContainText(prefix, { timeout: 20_000 });
    await page.getByRole("button", { name: "Geri" }).click();
    await expect(page.getByRole("heading", { name: "Duruşmalar" })).toBeVisible();

    await page.goto("/");
    await expect(page.locator("body")).toHaveClass(/is-authenticated/, { timeout: 30_000 });
    await gotoSection(page, "hearings");
    const persistedChip = page.locator("#hearingsPrintPanel #hearingCalendar .hearing-chip").filter({ hasText: prefix }).first();
    await expect(persistedChip).toBeVisible({ timeout: 30_000 });
    await persistedChip.locator("[data-edit-hearing]").click();
    await expect(page.locator("#hearingSubmit")).toHaveText("Güncelle");
    await page.locator("#hearingNew").click();
    page.once("dialog", dialog => dialog.accept().catch(() => {}));
    await persistedChip.locator("[data-delete-hearing]").click();
    await expect(page.locator("#hearingsPrintPanel #hearingCalendar")).not.toContainText(`${prefix} duruşma notu`, { timeout: 20_000 });
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
