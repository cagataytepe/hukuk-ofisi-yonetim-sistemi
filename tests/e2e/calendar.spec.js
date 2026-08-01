import { expect, test } from "@playwright/test";
import { attachDiagnostics, createLawsuitFile, currentWorkweekDateIso, deleteFileByPrefix, fillDatalistByPrefix, gotoSection, login, selectFirstOption } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Takvim ekranı public.hearings kayıtlarını tarihinde ve detay panelinde gösterir", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("CALENDAR");
  await login(page);

  try {
    await createLawsuitFile(page, prefix);
    await gotoSection(page, "hearings");
    await fillDatalistByPrefix(page, "#hearingCase", "#hearingCaseList", prefix);
    await page.locator('#hearingForm input[type="date"]').fill(currentWorkweekDateIso());
    await page.locator('#hearingForm input[type="time"]').fill("11:20");
    await selectFirstOption(page, "#hearingPerson");
    await page.locator("#hearingForm textarea").fill(`${prefix} takvim duruşması`);
    await page.locator("#hearingSubmit").click();
    await expect(page.locator("#hearingsPrintPanel #hearingCalendar")).toContainText(prefix, { timeout: 30_000 });

    await gotoSection(page, "calendar");
    const event = page.locator(".calendar-agenda-item.hearing").filter({ hasText: prefix }).first();
    await expect(event).toBeVisible({ timeout: 30_000 });
    await event.click();
    await expect(page.locator("#calendarEventDetail")).toBeVisible();
    await expect(page.locator("#calendarEventDetail")).toContainText(prefix);

    await gotoSection(page, "hearings");
    const chip = page.locator("#hearingsPrintPanel #hearingCalendar .hearing-chip").filter({ hasText: prefix }).first();
    page.once("dialog", dialog => dialog.accept().catch(() => {}));
    await chip.locator("[data-delete-hearing]").click();
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
