import { expect, test } from "@playwright/test";
import { attachDiagnostics, createLawsuitFile, deleteFileByPrefix, login, openFileDetailByPrefix, selectFirstOption, todayIso } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test.setTimeout(180_000);

async function openDetailTab(page, tab) {
  await page.locator(`[data-file-detail-tab="${tab}"]`).click();
  await expect(page.locator(`[data-file-detail-tab="${tab}"]`)).toHaveClass(/active/);
  await expect(page.locator("#fileDetailContent")).not.toContainText(/y[uü]kleniyor|loading/i, { timeout: 30_000 });
}

async function clickFirstDetailAction(page, selector) {
  const button = page.locator(selector).first();
  await expect(button).toBeVisible({ timeout: 15_000 });
  if (selector.includes("delete")) page.once("dialog", dialog => dialog.accept().catch(() => {}));
  await button.click();
  await expect(button).toBeHidden({ timeout: 30_000 });
}

test("Dosya detayi alt sekmeleri Supabase tablolarinda CRUD yapar", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("DETAIL");
  let diagnosticsLimit = 0;

  try {
    await test.step("E2E dosyasi olusturma", async () => {
      await login(page);
      await createLawsuitFile(page, prefix);
    });

    await test.step("Dosya Detayi acma", async () => {
      await openFileDetailByPrefix(page, prefix);
      await openDetailTab(page, "parties");
      await expect(page.locator("#fileDetailContent")).toContainText(prefix);
    });

    await test.step("Durusma CRUD", async () => {
      await openDetailTab(page, "hearings");
      await expect(page.locator("#fileDetailHearingForm")).toBeVisible({ timeout: 30_000 });
      await page.locator('#fileDetailHearingForm input[name="date"]').fill(todayIso(7));
      await page.locator('#fileDetailHearingForm input[name="time"]').fill("10:30");
      await page.locator('#fileDetailHearingForm textarea[name="note"]').fill(`${prefix} durusma notu`);
      await page.locator("#fileDetailHearingForm button[type='submit']").click();
      await expect(page.locator("#fileDetailContent")).toContainText(`${prefix} durusma notu`);
      await clickFirstDetailAction(page, "[data-detail-complete-hearing]");
      await clickFirstDetailAction(page, "[data-detail-reopen-hearing]");
      await clickFirstDetailAction(page, "[data-detail-delete-hearing]");
    });

    await test.step("Sureli Is CRUD", async () => {
      await openDetailTab(page, "deadlines");
      await expect(page.locator("#fileDetailDeadlineForm")).toBeVisible({ timeout: 30_000 });
      await page.locator('#fileDetailDeadlineForm input[name="task"]').fill(`${prefix} sureli is`);
      await selectFirstOption(page, '#fileDetailDeadlineForm select[name="responsible"]');
      await page.locator('#fileDetailDeadlineForm input[name="start"]').fill(todayIso());
      await page.locator('#fileDetailDeadlineForm input[name="due"]').fill(todayIso(5));
      await page.locator('#fileDetailDeadlineForm textarea[name="description"]').fill(`${prefix} sure aciklamasi`);
      await page.locator("#fileDetailDeadlineForm button[type='submit']").click();
      await expect(page.locator("#fileDetailContent")).toContainText(`${prefix} sureli is`);
      await clickFirstDetailAction(page, "[data-detail-complete-deadline]");
      await clickFirstDetailAction(page, "[data-detail-reopen-deadline]");
      await clickFirstDetailAction(page, "[data-detail-delete-deadline]");
    });

    await test.step("Gorev CRUD", async () => {
      await openDetailTab(page, "tasks");
      await expect(page.locator("#fileDetailTaskForm")).toBeVisible({ timeout: 30_000 });
      await page.locator('#fileDetailTaskForm input[name="title"]').fill(`${prefix} gorev`);
      await selectFirstOption(page, '#fileDetailTaskForm select[name="responsible"]');
      await page.locator('#fileDetailTaskForm input[name="dueDate"]').fill(todayIso(4));
      await page.locator('#fileDetailTaskForm textarea[name="description"]').fill(`${prefix} gorev aciklamasi`);
      await page.locator("#fileDetailTaskForm button[type='submit']").click();
      await expect(page.locator("#fileDetailContent")).toContainText(`${prefix} gorev`);
      await clickFirstDetailAction(page, "[data-detail-complete-task]");
      await clickFirstDetailAction(page, "[data-detail-reopen-task]");
      await clickFirstDetailAction(page, "[data-detail-delete-task]");
    });

    await test.step("Tahsilat CRUD", async () => {
      await openDetailTab(page, "collections");
      await expect(page.locator("#fileDetailCollectionForm")).toBeVisible({ timeout: 30_000 });
      await page.locator('#fileDetailCollectionForm input[name="amount"]').fill("123.45");
      await page.locator('#fileDetailCollectionForm input[name="description"]').fill(`${prefix} tahsilat`);
      await page.locator("#fileDetailCollectionForm button[type='submit']").click();
      await expect(page.locator("#fileDetailContent")).toContainText(`${prefix} tahsilat`);
      await clickFirstDetailAction(page, "[data-detail-delete-collection]");
    });

    await test.step("Not CRUD", async () => {
      await openDetailTab(page, "notes");
      await expect(page.locator("#fileDetailNoteForm")).toBeVisible({ timeout: 30_000 });
      await page.locator('#fileDetailNoteForm textarea[name="text"]').fill(`${prefix} not`);
      await page.locator("#fileDetailNoteForm button[type='submit']").click();
      await expect(page.locator("#fileDetailContent")).toContainText(`${prefix} not`);
    });

    await test.step("Timeline kontrolu", async () => {
      await openDetailTab(page, "timeline");
      await expect(page.locator("#fileDetailContent")).toContainText(/Not eklendi|Tahsilat/i);
      await openDetailTab(page, "paymentPlans");
      await expect(page.locator("#fileDetailContent")).toContainText(/\u00d6deme|\u00f6deme plan/i);
    });

    diagnosticsLimit = diagnostics.mark();
  } finally {
    await test.step("Temizlik", async () => {
      if (page.isClosed()) {
        console.warn("E2E cleanup skipped because the page is already closed.", { prefix });
        return;
      }
      await deleteFileByPrefix(page, prefix, { timeout: 20_000 });
    });
  }

  diagnostics.assertClean({ to: diagnosticsLimit });
});
